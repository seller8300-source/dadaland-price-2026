'use strict';
const fs = require('node:fs');
const { getDb, getSetting, setSetting, audit } = require('../db');
const http = require('../http');
const auth = require('../auth');
const multipart = require('../multipart');
const photosLib = require('../photos');
const scheduler = require('../scheduler');
const importer = require('../import');
const stats = require('../stats');
const templates = require('../templates');
const messaging = require('../messaging');
const view = require('../views/admin');
const { nowIso, normalizePhone, normalizeDate } = require('../util');

const PAGE_SIZE = 30;
const MAX_FORM_BYTES = 1024 * 256;
const MAX_UPLOAD_BYTES = Number(process.env.STONEKIM_MAX_UPLOAD_BYTES || 120 * 1024 * 1024);

/** 안전한 플래시 메시지 (임의 문자열을 URL 로 실어 나르지 않는다) */
const FLASH = {
  saved: () => ['ok', '저장했습니다.'],
  sent: (n) => ['ok', `메시지를 발송했습니다.${n ? ` (${n})` : ''}`],
  send_failed: () => ['err', '발송에 실패했습니다. 발송 로그를 확인해 주세요.'],
  stopped: (n) => ['ok', `예약된 메시지 ${n || 0}건을 중단했습니다.`],
  excluded: () => ['ok', '자동 메시지 발송 제외로 설정했습니다.'],
  included: () => ['ok', '자동 메시지 발송 제외를 해제했습니다.'],
  rescheduled: () => ['ok', '시공예정일을 변경하고 1차 메시지를 다시 예약했습니다.'],
  photo_added: (n) => ['ok', `사진 ${n || 0}장을 등록했습니다.`],
  photo_error: () => ['err', '사진 등록에 실패했습니다. 파일 형식과 용량을 확인해 주세요.'],
  reward_saved: () => ['ok', '리워드 정보를 저장했습니다.'],
  reviewed: () => ['ok', '검수 결과를 반영했습니다.'],
  imported: (created, scheduled) => [
    'ok',
    `${created || 0}건을 등록했습니다. (자동발송 예약 ${scheduled || 0}건)`,
  ],
  import_hold: (created) => ['ok', `${created || 0}건을 등록했습니다. 자동발송은 보류 상태입니다.`],
  import_error: () => ['err', '엑셀 파일을 읽을 수 없습니다. 형식을 확인해 주세요.'],
  discarded: () => ['info', '업로드를 취소했습니다.'],
  test_sent: () => ['ok', '테스트 메시지를 발송했습니다.'],
  test_failed: () => ['err', '테스트 발송에 실패했습니다. 번호와 발송 설정을 확인해 주세요.'],
  password_changed: () => ['ok', '비밀번호를 변경했습니다. 다시 로그인해 주세요.'],
  password_failed: () => ['err', '현재 비밀번호가 올바르지 않거나 새 비밀번호가 너무 짧습니다.'],
  csrf: () => ['err', '요청이 만료되었습니다. 다시 시도해 주세요.'],
  not_found: () => ['err', '대상을 찾을 수 없습니다.'],
  excluded_blocked: () => ['err', '발송 제외 또는 사진 등록 상태라 발송하지 않았습니다.'],
};

function flashFrom(url) {
  const code = url.searchParams.get('f');
  if (!code || !FLASH[code]) return null;
  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');
  const [type, message] = FLASH[code](a ? Number(a) : undefined, b ? Number(b) : undefined);
  return { type, message };
}

function flashUrl(path, code, a, b) {
  const params = new URLSearchParams({ f: code });
  if (a !== undefined && a !== null) params.set('a', String(a));
  if (b !== undefined && b !== null) params.set('b', String(b));
  return `${path}?${params.toString()}`;
}

function requireSession(req) {
  const cookies = http.parseCookies(req);
  return auth.sessionFromToken(cookies.sk_admin);
}

async function readFormBody(req, res) {
  const buffer = await http.readBody(req, res, MAX_FORM_BYTES);
  if (buffer === null) return null;
  return http.parseForm(buffer);
}

function csrfOk(session, fields) {
  return auth.checkCsrf(session, fields && fields.csrf);
}

/* ---------------------------------------------------------------- 로그인 */

async function handleLogin(req, res, url) {
  if (req.method === 'GET') {
    const notice = url.searchParams.get('bootstrap')
      ? '최초 관리자 계정이 생성되었습니다. 서버 로그의 비밀번호로 로그인하세요.'
      : null;
    return http.html(res, view.loginPage({ error: null, notice }));
  }
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  const session = auth.login(String(fields.username || '').trim(), String(fields.password || ''), http.clientIp(req));
  if (!session) {
    return http.html(res, view.loginPage({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }), 401);
  }
  http.setCookie(res, 'sk_admin', session.token, {
    maxAge: auth.SESSION_HOURS * 3600,
    secure: !!process.env.STONEKIM_SECURE_COOKIE,
  });
  return http.redirect(res, '/admin');
}

/* ------------------------------------------------------------ 목록 조회 */

const LIST_SELECT = `
  SELECT p.*, c.name AS customer_name, c.phone,
    (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.project_id) AS photo_count,
    (SELECT r.status FROM rewards r WHERE r.project_id = p.project_id) AS reward_status,
    (SELECT m.scheduled_at FROM messages m WHERE m.project_id = p.project_id AND m.status='SCHEDULED'
      ORDER BY m.scheduled_at LIMIT 1) AS next_scheduled_at,
    (SELECT m.message_type FROM messages m WHERE m.project_id = p.project_id AND m.status='SCHEDULED'
      ORDER BY m.scheduled_at LIMIT 1) AS next_type
   FROM projects p JOIN customers c ON c.customer_id = p.customer_id`;

const FILTER_SQL = {
  all: '1=1',
  scheduled: "p.status = 'READY'",
  sent1: "p.status = 'SENT_1'",
  sent2: "p.status = 'SENT_2'",
  sentfinal: "p.status = 'SENT_FINAL'",
  photo: "p.status = 'PHOTO_SUBMITTED'",
  reward_review: "EXISTS (SELECT 1 FROM rewards r WHERE r.project_id = p.project_id AND r.status = 'PENDING')",
  reward_done: "EXISTS (SELECT 1 FROM rewards r WHERE r.project_id = p.project_id AND r.status = 'PAID')",
  excluded: 'p.message_excluded = 1',
};

function listProjects({ filter = 'all', query = '', page = 1 }) {
  const db = getDb();
  const where = [FILTER_SQL[filter] || FILTER_SQL.all];
  const args = [];
  if (query) {
    const like = `%${query}%`;
    const digits = query.replace(/[^0-9]/g, '');
    where.push(
      '(p.order_number LIKE ? OR c.name LIKE ? OR p.site_name LIKE ? OR p.product LIKE ?' +
        (digits ? ' OR c.phone LIKE ?' : '') + ')'
    );
    args.push(like, like, like, like);
    if (digits) args.push(`%${digits}%`);
  }
  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM projects p JOIN customers c ON c.customer_id = p.customer_id WHERE ${whereSql}`)
    .get(...args).c;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = db
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY p.ship_date DESC, p.project_id DESC LIMIT ? OFFSET ?`)
    .all(...args, PAGE_SIZE, (current - 1) * PAGE_SIZE);
  return { rows, total, pages, page: current };
}

/* ------------------------------------------------------------- 핸들러들 */

function dashboard(req, res, url, session) {
  const recent = getDb()
    .prepare(
      `SELECT p.project_id, p.order_number, p.site_name, p.photo_submitted_at, c.name AS customer_name,
              (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.project_id) AS photo_count,
              (SELECT r.status FROM rewards r WHERE r.project_id = p.project_id) AS reward_status
         FROM projects p JOIN customers c ON c.customer_id = p.customer_id
        WHERE p.photo_submitted_at IS NOT NULL
        ORDER BY p.photo_submitted_at DESC LIMIT 8`
    )
    .all();
  return http.html(
    res,
    view.dashboardPage({
      stats: stats.dashboard(),
      kpi: stats.kpi(),
      recent,
      session,
      flash: flashFrom(url),
    })
  );
}

function projectsList(req, res, url, session) {
  const filter = url.searchParams.get('filter') || 'all';
  const query = (url.searchParams.get('q') || '').trim();
  const page = Number(url.searchParams.get('page') || 1) || 1;
  const result = listProjects({ filter, query, page });
  return http.html(
    res,
    view.projectsPage({ ...result, filter, query, session, flash: flashFrom(url) })
  );
}

function loadProject(projectId) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
  if (!project) return null;
  const customer = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(project.customer_id);
  return { project, customer };
}

function projectDetail(req, res, url, session, projectId) {
  const found = loadProject(projectId);
  if (!found) return http.redirect(res, flashUrl('/admin/projects', 'not_found'));
  const db = getDb();
  const messages = db
    .prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY message_id DESC')
    .all(projectId);
  const reward = db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(projectId);
  return http.html(
    res,
    view.projectDetailPage({
      project: { ...found.project, upload_url: scheduler.uploadUrl(found.project.upload_token) },
      customer: found.customer,
      photos: photosLib.listPhotos(projectId),
      messages,
      reward,
      session,
      flash: flashFrom(url),
    })
  );
}

function reviewQueue(req, res, url, session) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.project_id, p.order_number, p.site_name, p.product, p.region, p.photo_submitted_at,
              c.name AS customer_name,
              (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.project_id) AS photo_count,
              (SELECT r.status FROM rewards r WHERE r.project_id = p.project_id) AS reward_status
         FROM projects p JOIN customers c ON c.customer_id = p.customer_id
        WHERE p.photo_submitted_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM photos ph WHERE ph.project_id = p.project_id AND ph.review_status = 'PENDING')
        ORDER BY p.photo_submitted_at ASC LIMIT 40`
    )
    .all()
    .map((row) => ({ ...row, photos: photosLib.listPhotos(row.project_id) }));
  return http.html(res, view.reviewPage({ rows, session, flash: flashFrom(url) }));
}

function rewardsList(req, res, url, session) {
  const db = getDb();
  const filter = url.searchParams.get('filter') || 'all';
  const where = filter === 'all' ? '1=1' : 'r.status = ?';
  const args = filter === 'all' ? [] : [filter];
  const rows = db
    .prepare(
      `SELECT r.*, p.order_number, p.site_name, c.name AS customer_name,
              (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.project_id) AS photo_count
         FROM rewards r
         JOIN projects p ON p.project_id = r.project_id
         JOIN customers c ON c.customer_id = p.customer_id
        WHERE ${where}
        ORDER BY r.updated_at DESC LIMIT 200`
    )
    .all(...args);
  const totals = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='SCHEDULED' THEN 1 ELSE 0 END) AS scheduled,
        SUM(CASE WHEN status='PAID' THEN 1 ELSE 0 END) AS paid,
        COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END),0) AS paid_amount
       FROM rewards`
    )
    .get();
  return http.html(
    res,
    view.rewardsPage({
      rows,
      filter,
      totals: {
        pending: totals.pending || 0,
        scheduled: totals.scheduled || 0,
        paid: totals.paid || 0,
        paid_amount: totals.paid_amount || 0,
      },
      session,
      flash: flashFrom(url),
    })
  );
}

function messagesLog(req, res, url, session) {
  const db = getDb();
  const filter = url.searchParams.get('filter') || 'all';
  const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
  const where = filter === 'all' ? '1=1' : 'm.status = ?';
  const args = filter === 'all' ? [] : [filter];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM messages m WHERE ${where}`).get(...args).c;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = db
    .prepare(
      `SELECT m.*, p.order_number, COALESCE(c.name, '테스트 발송') AS customer_name,
              COALESCE(c.phone, m.to_phone) AS phone,
              (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.project_id) AS photo_count
         FROM messages m
         LEFT JOIN projects p ON p.project_id = m.project_id
         LEFT JOIN customers c ON c.customer_id = p.customer_id
        WHERE ${where}
        ORDER BY COALESCE(m.sent_at, m.scheduled_at) DESC, m.message_id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...args, PAGE_SIZE, (current - 1) * PAGE_SIZE);
  return http.html(
    res,
    view.messagesPage({ rows, filter, page: current, pages, session, flash: flashFrom(url), stats: stats.kpi() })
  );
}

function serveMedia(req, res, photoId) {
  const photo = photosLib.getPhoto(photoId);
  if (!photo) return http.text(res, 'not found', 404);
  let full;
  try {
    full = photosLib.absolutePath(photo);
  } catch {
    return http.text(res, 'not found', 404);
  }
  if (!fs.existsSync(full)) return http.text(res, 'not found', 404);
  const stat = fs.statSync(full);
  res.writeHead(200, {
    'Content-Type': photo.mime_type || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

/* ----------------------------------------------------------- 액션(POST) */

async function actionSend(req, res, session, projectId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'csrf'));
  const type = ['FIRST', 'SECOND', 'FINAL'].includes(fields.type) ? fields.type : 'FIRST';
  const result = await scheduler.sendNow(projectId, type);
  audit(session, 'MANUAL_SEND', projectId, type, http.clientIp(req));
  if (!result.ok) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'excluded_blocked'));
  if (result.skipped) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'excluded_blocked'));
  const code = result.sent === 'FAILED' ? 'send_failed' : 'sent';
  return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, code));
}

async function actionStop(req, res, session, projectId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'csrf'));
  const canceled = scheduler.cancelScheduled(projectId, 'CANCELED_ADMIN', '관리자 중단');
  audit(session, 'STOP_MESSAGES', projectId, `${canceled}건`, http.clientIp(req));
  return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'stopped', canceled));
}

async function actionExclude(req, res, session, projectId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'csrf'));
  const exclude = fields.value === '1';
  const db = getDb();
  db.prepare('UPDATE projects SET message_excluded = ?, excluded_reason = ?, updated_at = ? WHERE project_id = ?')
    .run(exclude ? 1 : 0, exclude ? '관리자 지정' : null, nowIso(), projectId);
  if (exclude) {
    scheduler.cancelScheduled(projectId, 'CANCELED_ADMIN', '발송 제외 지정');
  } else {
    scheduler.scheduleFirstMessage(projectId);
  }
  audit(session, exclude ? 'EXCLUDE' : 'INCLUDE', projectId, null, http.clientIp(req));
  return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, exclude ? 'excluded' : 'included'));
}

async function actionSchedule(req, res, session, projectId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'csrf'));
  const db = getDb();
  const date = normalizeDate(fields.installation_date);
  db.prepare('UPDATE projects SET installation_date = ?, updated_at = ? WHERE project_id = ?')
    .run(date, nowIso(), projectId);
  // 아직 발송 전인 1차 메시지는 새 일정으로 다시 예약한다.
  const pending = db
    .prepare("SELECT * FROM messages WHERE project_id = ? AND status = 'SCHEDULED' AND message_type = 'FIRST'")
    .get(projectId);
  const project = db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
  if (pending) {
    const at = scheduler.computeFirstScheduleAt(project, scheduler.sendHour());
    db.prepare('UPDATE messages SET scheduled_at = ? WHERE message_id = ?').run(at, pending.message_id);
  } else if (project.status === 'READY' && !project.message_excluded) {
    scheduler.scheduleFirstMessage(projectId);
  }
  audit(session, 'CHANGE_INSTALL_DATE', projectId, date, http.clientIp(req));
  return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'rescheduled'));
}

async function actionReward(req, res, session, projectId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'csrf'));
  const db = getDb();
  let amount = 0;
  if (fields.amount_preset === 'custom') amount = Math.max(0, Math.round(Number(fields.amount_custom || 0)));
  else amount = Math.max(0, Math.round(Number(fields.amount_preset || 0)));
  const status = ['PENDING', 'SCHEDULED', 'PAID', 'EXCLUDED'].includes(fields.status) ? fields.status : 'PENDING';
  const memo = String(fields.memo || '').slice(0, 1000);
  const existing = db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(projectId);
  const paidAt = status === 'PAID' ? (existing && existing.paid_at) || nowIso() : null;
  if (existing) {
    db.prepare('UPDATE rewards SET amount = ?, status = ?, paid_at = ?, memo = ?, updated_at = ? WHERE project_id = ?')
      .run(amount, status, paidAt, memo, nowIso(), projectId);
  } else {
    db.prepare(
      'INSERT INTO rewards (project_id, amount, status, paid_at, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(projectId, amount, status, paidAt, memo, nowIso(), nowIso());
  }
  audit(session, 'REWARD_UPDATE', projectId, `${amount}/${status}`, http.clientIp(req));
  return http.redirect(res, flashUrl(`/admin/projects/${projectId}`, 'reward_saved'));
}

async function actionPhotoReview(req, res, session, photoId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  const photo = photosLib.getPhoto(photoId);
  if (!photo) return http.redirect(res, flashUrl('/admin/projects', 'not_found'));
  const back = `/admin/projects/${photo.project_id}`;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl(back, 'csrf'));
  if (fields.action === 'best') photosLib.setBest(photoId, !photo.is_best);
  else if (fields.action === 'usable') photosLib.setReview(photoId, photo.review_status === 'USABLE' ? 'PENDING' : 'USABLE');
  else if (fields.action === 'unusable') photosLib.setReview(photoId, photo.review_status === 'UNUSABLE' ? 'PENDING' : 'UNUSABLE');
  audit(session, 'PHOTO_REVIEW', photoId, fields.action, http.clientIp(req));
  return http.redirect(res, flashUrl(back, 'reviewed'));
}

async function actionAdminPhotoUpload(req, res, session, projectId) {
  const body = await http.readBody(req, res, MAX_UPLOAD_BYTES);
  if (body === null) return true;
  const back = `/admin/projects/${projectId}`;
  let parsed;
  try {
    parsed = multipart.parse(body, req.headers['content-type']);
  } catch {
    return http.redirect(res, flashUrl(back, 'photo_error'));
  }
  if (!csrfOk(session, parsed.fields)) return http.redirect(res, flashUrl(back, 'csrf'));
  const existing = photosLib.listPhotos(projectId).length;
  const files = parsed.files.filter((f) => f.field === 'photos');
  const validation = photosLib.validateFiles(files, { existingCount: existing, enforceMin: false });
  if (!validation.ok) return http.redirect(res, flashUrl(back, 'photo_error'));
  photosLib.storePhotos(projectId, validation.accepted, 'ADMIN');
  const project = getDb().prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
  if (project && project.status !== 'PHOTO_SUBMITTED') scheduler.onPhotoSubmitted(projectId);
  audit(session, 'ADMIN_PHOTO_UPLOAD', projectId, `${validation.accepted.length}장`, http.clientIp(req));
  return http.redirect(res, flashUrl(back, 'photo_added', validation.accepted.length));
}

/* ------------------------------------------------------------ 엑셀 업로드 */

function importHome(req, res, url, session) {
  const recent = getDb()
    .prepare('SELECT * FROM import_batches ORDER BY batch_id DESC LIMIT 10')
    .all();
  return http.html(res, view.importPage({ session, flash: flashFrom(url), recent }));
}

async function importUpload(req, res, session) {
  const body = await http.readBody(req, res, 25 * 1024 * 1024);
  if (body === null) return true;
  let parsed;
  try {
    parsed = multipart.parse(body, req.headers['content-type']);
  } catch {
    return http.redirect(res, flashUrl('/admin/import', 'import_error'));
  }
  if (!csrfOk(session, parsed.fields)) return http.redirect(res, flashUrl('/admin/import', 'csrf'));
  const file = parsed.files.find((f) => f.field === 'file');
  if (!file) return http.redirect(res, flashUrl('/admin/import', 'import_error'));
  let result;
  try {
    result = importer.parseUpload(file.data, file.filename);
  } catch (err) {
    console.error('[import]', err.message);
    return http.redirect(res, flashUrl('/admin/import', 'import_error'));
  }
  const batchId = importer.saveBatch({
    fileName: file.filename,
    rows: result.rows,
    summary: result.summary,
    username: session.username,
  });
  audit(session, 'IMPORT_PREVIEW', batchId, file.filename, http.clientIp(req));
  return http.redirect(res, `/admin/import/${batchId}`);
}

function importPreview(req, res, url, session, batchId) {
  const batch = importer.getBatch(batchId);
  if (!batch) return http.redirect(res, flashUrl('/admin/import', 'not_found'));
  if (batch.status !== 'PREVIEW') return http.redirect(res, flashUrl('/admin/import', 'discarded'));
  return http.html(
    res,
    view.importPreviewPage({
      batch,
      rows: batch.rows,
      summary: importer.summarize(batch.rows),
      session,
      flash: flashFrom(url),
    })
  );
}

async function importCommit(req, res, session, batchId) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl('/admin/import', 'csrf'));
  const hold = fields.mode === 'hold';
  const result = importer.commitBatch(batchId, { hold });
  if (!result.ok) return http.redirect(res, flashUrl('/admin/import', 'import_error'));
  audit(session, 'IMPORT_COMMIT', batchId, `${result.created}건 / 예약 ${result.scheduled}`, http.clientIp(req));
  return hold
    ? http.redirect(res, flashUrl('/admin/projects', 'import_hold', result.created))
    : http.redirect(res, flashUrl('/admin/projects', 'imported', result.created, result.scheduled));
}

function importDiscard(req, res, session, batchId) {
  importer.discardBatch(batchId);
  audit(session, 'IMPORT_DISCARD', batchId, null, http.clientIp(req));
  return http.redirect(res, flashUrl('/admin/import', 'discarded'));
}

/* ----------------------------------------------------------------- 설정 */

function settingsPage(req, res, url, session) {
  const audits = getDb().prepare('SELECT * FROM audit_logs ORDER BY log_id DESC LIMIT 30').all();
  return http.html(
    res,
    view.settingsPage({
      session,
      flash: flashFrom(url),
      settings: {
        consent_text: getSetting('consent_text'),
        privacy_text: getSetting('privacy_text'),
        reward_notice: getSetting('reward_notice'),
        min_photos: getSetting('min_photos'),
        max_photos: getSetting('max_photos'),
        send_hour_kst: getSetting('send_hour_kst'),
        test_phone: getSetting('test_phone'),
      },
      audits,
      provider: messaging.provider() === 'mock' ? '모의 발송 (mock)' : 'HTTP 게이트웨이',
      baseUrl: scheduler.baseUrl(),
    })
  );
}

async function settingsSave(req, res, session) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl('/admin/settings', 'csrf'));
  const textKeys = ['consent_text', 'privacy_text', 'reward_notice'];
  for (const key of textKeys) {
    if (fields[key] !== undefined) setSetting(key, String(fields[key]).slice(0, 2000));
  }
  const min = Math.max(1, Math.min(20, Number(fields.min_photos) || 3));
  const max = Math.max(min, Math.min(20, Number(fields.max_photos) || 10));
  setSetting('min_photos', min);
  setSetting('max_photos', max);
  const hour = Math.max(0, Math.min(23, Number(fields.send_hour_kst)));
  setSetting('send_hour_kst', Number.isFinite(hour) ? hour : 10);
  setSetting('test_phone', normalizePhone(fields.test_phone) || '');
  audit(session, 'SETTINGS_UPDATE', null, null, http.clientIp(req));
  return http.redirect(res, flashUrl('/admin/settings', 'saved'));
}

async function testSend(req, res, session) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl('/admin/settings', 'csrf'));
  const phone = normalizePhone(fields.phone);
  if (!phone) return http.redirect(res, flashUrl('/admin/settings', 'test_failed'));
  const type = ['FIRST', 'SECOND', 'FINAL'].includes(fields.type) ? fields.type : 'FIRST';
  const sampleUrl = `${scheduler.baseUrl()}/project/upload/TEST-PREVIEW`;
  const body = templates.buildBody(type, sampleUrl);
  const result = await messaging.deliver({ phone, body, messageType: type });
  getDb()
    .prepare(
      `INSERT INTO messages (project_id, to_phone, message_type, scheduled_at, sent_at, channel, status, failure_reason, body, provider_ref, created_at)
       VALUES (NULL, ?, 'TEST', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(phone, nowIso(), nowIso(), result.channel, result.status, result.error, body, result.ref, nowIso());
  setSetting('test_phone', phone);
  audit(session, 'TEST_SEND', phone, result.status, http.clientIp(req));
  return http.redirect(
    res,
    flashUrl('/admin/settings', result.status === 'FAILED' ? 'test_failed' : 'test_sent')
  );
}

async function changePassword(req, res, session) {
  const fields = await readFormBody(req, res);
  if (!fields) return true;
  if (!csrfOk(session, fields)) return http.redirect(res, flashUrl('/admin/settings', 'csrf'));
  const user = auth.findUser(session.username);
  const next = String(fields.next || '');
  if (!user || !auth.verifyPassword(String(fields.current || ''), user.password_hash) || next.length < 8) {
    return http.redirect(res, flashUrl('/admin/settings', 'password_failed'));
  }
  auth.changePassword(user.user_id, next);
  audit(session, 'PASSWORD_CHANGE', user.username, null, http.clientIp(req));
  http.setCookie(res, 'sk_admin', '', { maxAge: 0 });
  return http.redirect(res, '/admin/login?f=password_changed');
}

/* --------------------------------------------------------------- 라우터 */

async function handle(req, res, url) {
  const { pathname } = url;
  if (!pathname.startsWith('/admin')) return false;

  if (pathname === '/admin/login') return handleLogin(req, res, url);

  const session = requireSession(req);
  if (!session) {
    if (req.method === 'GET') return http.redirect(res, '/admin/login');
    return http.text(res, '로그인이 필요합니다.', 401);
  }

  if (pathname === '/admin/logout' && req.method === 'POST') {
    const fields = await readFormBody(req, res);
    if (fields && csrfOk(session, fields)) {
      auth.logout(session.token);
      audit(session, 'LOGOUT', session.username, null, http.clientIp(req));
    }
    http.setCookie(res, 'sk_admin', '', { maxAge: 0 });
    return http.redirect(res, '/admin/login');
  }

  if (pathname === '/admin' && req.method === 'GET') return dashboard(req, res, url, session);
  if (pathname === '/admin/projects' && req.method === 'GET') return projectsList(req, res, url, session);
  if (pathname === '/admin/review' && req.method === 'GET') return reviewQueue(req, res, url, session);
  if (pathname === '/admin/rewards' && req.method === 'GET') return rewardsList(req, res, url, session);
  if (pathname === '/admin/messages' && req.method === 'GET') return messagesLog(req, res, url, session);
  if (pathname === '/admin/settings') {
    if (req.method === 'GET') return settingsPage(req, res, url, session);
    if (req.method === 'POST') return settingsSave(req, res, session);
  }
  if (pathname === '/admin/test-send' && req.method === 'POST') return testSend(req, res, session);
  if (pathname === '/admin/password' && req.method === 'POST') return changePassword(req, res, session);

  if (pathname === '/admin/import') {
    if (req.method === 'GET') return importHome(req, res, url, session);
    if (req.method === 'POST') return importUpload(req, res, session);
  }

  let params;
  if ((params = http.match('/admin/import/:id', pathname)) && req.method === 'GET')
    return importPreview(req, res, url, session, Number(params.id));
  if ((params = http.match('/admin/import/:id/commit', pathname)) && req.method === 'POST')
    return importCommit(req, res, session, Number(params.id));
  if ((params = http.match('/admin/import/:id/discard', pathname)) && req.method === 'GET')
    return importDiscard(req, res, session, Number(params.id));

  if ((params = http.match('/admin/projects/:id', pathname)) && req.method === 'GET')
    return projectDetail(req, res, url, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/send', pathname)) && req.method === 'POST')
    return actionSend(req, res, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/stop', pathname)) && req.method === 'POST')
    return actionStop(req, res, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/exclude', pathname)) && req.method === 'POST')
    return actionExclude(req, res, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/schedule', pathname)) && req.method === 'POST')
    return actionSchedule(req, res, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/reward', pathname)) && req.method === 'POST')
    return actionReward(req, res, session, Number(params.id));
  if ((params = http.match('/admin/projects/:id/photos', pathname)) && req.method === 'POST')
    return actionAdminPhotoUpload(req, res, session, Number(params.id));
  if ((params = http.match('/admin/photos/:id/review', pathname)) && req.method === 'POST')
    return actionPhotoReview(req, res, session, Number(params.id));
  if ((params = http.match('/admin/media/:id', pathname)) && req.method === 'GET')
    return serveMedia(req, res, Number(params.id));

  return false;
}

module.exports = { handle, listProjects, FLASH };
