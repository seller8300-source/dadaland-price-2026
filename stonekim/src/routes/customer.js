'use strict';
const { getDb, getSetting } = require('../db');
const { nowIso } = require('../util');
const http = require('../http');
const multipart = require('../multipart');
const photos = require('../photos');
const rewardTiers = require('../reward');
const scheduler = require('../scheduler');
const view = require('../views/customer');

const MAX_UPLOAD_BYTES = Number(process.env.STONEKIM_MAX_UPLOAD_BYTES || 120 * 1024 * 1024);

function findByToken(token) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE upload_token = ?').get(token);
  if (!project) return null;
  const customer = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(project.customer_id);
  return { project, customer };
}

function recordVisit(project, req) {
  const db = getDb();
  db.prepare(
    `UPDATE projects SET open_count = open_count + 1,
        first_opened_at = COALESCE(first_opened_at, ?), updated_at = ?
      WHERE project_id = ?`
  ).run(nowIso(), nowIso(), project.project_id);
  db.prepare('INSERT INTO page_visits (project_id, visited_at, user_agent) VALUES (?,?,?)')
    .run(project.project_id, nowIso(), String(req.headers['user-agent'] || '').slice(0, 300));
}

function settingsForPage() {
  return {
    consentText: getSetting('consent_text'),
    privacyText: getSetting('privacy_text'),
    reward: rewardTiers.current(),
    minPhotos: photos.limits().min,
    maxPhotos: photos.limits().max,
  };
}

function notFound(res) {
  const page = view.noticePage({
    title: '유효하지 않은 링크입니다.',
    message: '링크가 만료되었거나 주소가 정확하지 않습니다. 문자로 받으신 링크를 다시 확인해 주세요.',
    status: 404,
  });
  http.html(res, page.html, page.status);
}

async function handle(req, res, url) {
  const params = http.match('/project/upload/:token', url.pathname);
  const doneParams = http.match('/project/upload/:token/done', url.pathname);

  if (doneParams && req.method === 'GET') {
    const found = findByToken(doneParams.token);
    if (!found) return notFound(res);
    const count = getDb()
      .prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?')
      .get(found.project.project_id).c;
    return http.html(res, view.donePage({ photoCount: count, reward: rewardTiers.current() }));
  }

  if (!params) return false;

  const found = findByToken(params.token);
  if (!found) return notFound(res);
  const { project, customer } = found;

  if (req.method === 'GET') {
    recordVisit(project, req);
    if (project.status === 'PHOTO_SUBMITTED') {
      const count = getDb()
        .prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?')
        .get(project.project_id).c;
      return http.html(res, view.donePage({ photoCount: count, reward: rewardTiers.current() }));
    }
    return http.html(res, view.uploadPage({ project, customer, error: null, ...settingsForPage() }));
  }

  if (req.method === 'POST') {
    return submit(req, res, project, customer);
  }

  res.writeHead(405).end();
  return true;
}

async function submit(req, res, project, customer) {
  const isXhr = String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
  const doneUrl = `/project/upload/${project.upload_token}/done`;

  const fail = (message, status = 400) => {
    if (isXhr) return http.json(res, { ok: false, error: message }, status);
    return http.html(
      res,
      view.uploadPage({ project, customer, error: message, ...settingsForPage() }),
      status
    );
  };

  if (project.status === 'PHOTO_SUBMITTED') {
    if (isXhr) return http.json(res, { ok: true, redirect: doneUrl });
    return http.redirect(res, doneUrl);
  }

  const body = await http.readBody(req, res, MAX_UPLOAD_BYTES);
  if (body === null) return true; // 413 응답 완료

  let parsed;
  try {
    parsed = multipart.parse(body, req.headers['content-type']);
  } catch (err) {
    return fail('업로드 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  }

  if (!parsed.fields.consent) {
    return fail('사진 활용 동의에 체크해 주세요.');
  }

  const files = parsed.files.filter((file) => file.field === 'photos');
  const validation = photos.validateFiles(files, { existingCount: 0, enforceMin: true });
  if (!validation.ok) return fail(validation.error);

  const db = getDb();
  let savedCount = 0;
  let savedPaths = [];
  try {
    db.exec('BEGIN IMMEDIATE');
    // 중복 제출(연타·새로고침) 방지: 트랜잭션 안에서 상태를 다시 확인한다.
    const fresh = db.prepare('SELECT status FROM projects WHERE project_id = ?').get(project.project_id);
    if (fresh.status === 'PHOTO_SUBMITTED') {
      db.exec('ROLLBACK');
      if (isXhr) return http.json(res, { ok: true, redirect: doneUrl });
      return http.redirect(res, doneUrl);
    }
    savedPaths = photos.storePhotos(project.project_id, validation.accepted, 'CUSTOMER');
    savedCount = validation.accepted.length;
    db.prepare(
      `UPDATE projects SET region = COALESCE(NULLIF(?, ''), region),
              contractor = NULLIF(?, ''), sns = NULLIF(?, ''), review_text = NULLIF(?, ''),
              consent_at = ?, consent_text = ?, updated_at = ?
        WHERE project_id = ?`
    ).run(
      String(parsed.fields.region || '').trim(),
      String(parsed.fields.contractor || '').trim(),
      String(parsed.fields.sns || '').trim(),
      String(parsed.fields.review_text || '').trim().slice(0, 2000),
      nowIso(),
      getSetting('consent_text'),
      nowIso(),
      project.project_id
    );
    scheduler.onPhotoSubmitted(project.project_id);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    photos.removeFiles(savedPaths); // 롤백된 건의 파일은 남기지 않는다
    console.error('[upload] 저장 실패:', err);
    return fail('사진 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 500);
  }

  console.log(`[upload] 주문 ${project.order_number} 사진 ${savedCount}장 등록 · 예약 메시지 취소`);
  if (isXhr) return http.json(res, { ok: true, redirect: doneUrl, count: savedCount });
  return http.redirect(res, doneUrl);
}

module.exports = { handle, findByToken };
