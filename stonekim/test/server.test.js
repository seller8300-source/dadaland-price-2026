'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useTempData, jpegBytes, buildMultipart } = require('./helper');
useTempData('server');
process.env.STONEKIM_ADMIN_USER = 'admin';
process.env.STONEKIM_ADMIN_PASSWORD = 'test-password-1234';

const { getDb } = require('../src/db');
const { createServer, bootstrap } = require('../server');
const scheduler = require('../src/scheduler');
const importer = require('../src/import');
const { nowIso, randomToken } = require('../src/util');

let server;
let base;

test.before(async () => {
  bootstrap();
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.STONEKIM_BASE_URL = base;
});

test.after(() => server.close());

let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  return '0102222' + String(1000 + phoneSeq).slice(-4);
}

function seedProject(order = 'SK900', installDate = '2020-01-02') {
  const db = getDb();
  db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)')
    .run('김고객', nextPhone(), nowIso());
  const customerId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  const token = randomToken();
  db.prepare(
    `INSERT INTO projects (order_number, customer_id, product, ship_date, installation_date, site_name,
        upload_token, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'READY', ?, ?)`
  ).run(order, customerId, '칼라카타 600×2400', '2020-01-01', installDate, '테스트 현장', token, nowIso(), nowIso());
  const projectId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  scheduler.scheduleFirstMessage(projectId);
  return { projectId, token };
}

async function login() {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'test-password-1234' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const page = await fetch(`${base}/admin/settings`, { headers: { cookie } });
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  return { cookie, csrf };
}

/* ------------------------------------------------------------- 고객 화면 */

test('잘못된 토큰은 404 안내 화면', async () => {
  const res = await fetch(`${base}/project/upload/${'x'.repeat(40)}`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /유효하지 않은 링크/);
});

test('업로드 페이지는 로그인 없이 열리고 방문이 기록된다', async () => {
  const { projectId, token } = seedProject('SK901');
  const res = await fetch(`${base}/project/upload/${token}`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /시공사례 등록/);
  assert.match(html, /김고객 고객님 주문내역/);
  assert.match(html, /스톤킴의 홈페이지, SNS/, '동의 문구 노출');
  assert.doesNotMatch(html, /0102222/, '전화번호는 화면에 노출하지 않는다');

  const project = getDb().prepare('SELECT open_count, first_opened_at FROM projects WHERE project_id = ?').get(projectId);
  assert.equal(project.open_count, 1);
  assert.ok(project.first_opened_at);
});

test('동의 없이 제출하면 거부된다', async () => {
  const { token } = seedProject('SK902');
  const { body, contentType } = buildMultipart({ region: '서울' }, [
    { field: 'photos', filename: '1.jpg', data: jpegBytes(400) },
    { field: 'photos', filename: '2.jpg', data: jpegBytes(400) },
    { field: 'photos', filename: '3.jpg', data: jpegBytes(400) },
  ]);
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Requested-With': 'XMLHttpRequest' },
    body,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /동의/);
});

test('사진 3장 미만이면 거부된다', async () => {
  const { token } = seedProject('SK903');
  const { body, contentType } = buildMultipart({ consent: '1' }, [
    { field: 'photos', filename: '1.jpg', data: jpegBytes(400) },
  ]);
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Requested-With': 'XMLHttpRequest' },
    body,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /최소 3장/);
});

test('사진 제출 → 상태 변경 · 예약 메시지 취소 · 완료 화면', async () => {
  const { projectId, token } = seedProject('SK904');
  const db = getDb();
  await scheduler.processDue(new Date()); // 1차 발송 → 2차 예약
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id=? AND status='SCHEDULED'").get(projectId).c, 1);

  const { body, contentType } = buildMultipart(
    { consent: '1', region: '서울 강남구', contractor: '스톤인테리어', sns: '@stone', review_text: '마감이 깔끔합니다.' },
    [1, 2, 3, 4].map((i) => ({ field: 'photos', filename: `사진${i}.jpg`, data: jpegBytes(600) }))
  );
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Requested-With': 'XMLHttpRequest' },
    body,
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.count, 4);

  const project = db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
  assert.equal(project.status, 'PHOTO_SUBMITTED');
  assert.equal(project.region, '서울 강남구');
  assert.equal(project.contractor, '스톤인테리어');
  assert.equal(project.review_text, '마감이 깔끔합니다.');
  assert.ok(project.consent_at, '동의 시각 기록');
  assert.ok(project.consent_text, '동의 문구 스냅샷 보관');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?').get(projectId).c, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id=? AND status='SCHEDULED'").get(projectId).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id=? AND status='CANCELED_PHOTO'").get(projectId).c, 1);
  assert.ok(db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(projectId));

  const again = await fetch(`${base}/project/upload/${token}`);
  assert.match(await again.text(), /사진이 정상적으로 등록되었습니다/);
});

test('JS 가 없는 브라우저의 일반 폼 전송도 처리된다', async () => {
  const { projectId, token } = seedProject('SK907');
  const { body, contentType } = buildMultipart({ consent: '1', region: '대전 유성' },
    [1, 2, 3].map((i) => ({ field: 'photos', filename: `n${i}.jpg`, data: jpegBytes(300) })));
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/project/upload/${token}/done`);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id=?').get(projectId).c, 3);
});

test('연타·재제출로 사진이 중복 등록되지 않는다', async () => {
  const { projectId, token } = seedProject('SK908');
  const send = () => {
    const { body, contentType } = buildMultipart({ consent: '1' },
      [1, 2, 3].map((i) => ({ field: 'photos', filename: `d${i}.jpg`, data: jpegBytes(300) })));
    return fetch(`${base}/project/upload/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-Requested-With': 'XMLHttpRequest' },
      body,
    });
  };
  await send();
  const second = await send();
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, true);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id=?').get(projectId).c,
    3,
    '두 번째 제출은 무시된다'
  );
});

/* -------------------------------------------------------------- 관리자 */

test('관리자 페이지는 인증이 필요하다', async () => {
  const res = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');

  const media = await fetch(`${base}/admin/media/1`, { redirect: 'manual' });
  assert.equal(media.status, 302, '사진도 인증 없이는 볼 수 없다');
});

test('잘못된 비밀번호는 로그인되지 않고 기록된다', async () => {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'wrong' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 401);
  assert.ok(getDb().prepare("SELECT 1 AS x FROM audit_logs WHERE action='LOGIN_FAILED'").get());
});

test('로그인 후 대시보드와 목록을 볼 수 있다', async () => {
  const { cookie } = await login();
  const dash = await fetch(`${base}/admin`, { headers: { cookie } });
  const html = await dash.text();
  assert.equal(dash.status, 200);
  assert.match(html, /사진 등록률/);
  assert.match(html, /MVP 성공 기준 지표/);

  const list = await fetch(`${base}/admin/projects?filter=photo`, { headers: { cookie } });
  assert.match(await list.text(), /SK904/);

  const search = await fetch(`${base}/admin/projects?q=${encodeURIComponent('테스트 현장')}`, { headers: { cookie } });
  assert.match(await search.text(), /SK90/);
});

test('CSRF 토큰 없는 요청은 반영되지 않는다', async () => {
  const { cookie } = await login();
  const { projectId } = seedProject('SK905');
  const res = await fetch(`${base}/admin/projects/${projectId}/exclude`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ value: '1' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /f=csrf/);
  assert.equal(getDb().prepare('SELECT message_excluded FROM projects WHERE project_id=?').get(projectId).message_excluded, 0);
});

test('발송 제외 처리 시 예약 메시지가 중단된다', async () => {
  const { cookie, csrf } = await login();
  const { projectId } = seedProject('SK906', null);
  const res = await fetch(`${base}/admin/projects/${projectId}/exclude`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ value: '1', csrf }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  const db = getDb();
  assert.equal(db.prepare('SELECT message_excluded FROM projects WHERE project_id=?').get(projectId).message_excluded, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id=? AND status='SCHEDULED'").get(projectId).c, 0);
  assert.ok(db.prepare("SELECT 1 AS x FROM audit_logs WHERE action='EXCLUDE'").get(), '관리자 작업 로그 기록');
});

test('엑셀 업로드 → 미리보기 → 등록', async () => {
  const { cookie, csrf } = await login();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_shipment.xlsx'));
  const { body, contentType } = buildMultipart({ csrf }, [
    { field: 'file', filename: 'sample_shipment.xlsx', data: fixture, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ]);
  const upload = await fetch(`${base}/admin/import`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': contentType },
    body,
    redirect: 'manual',
  });
  assert.equal(upload.status, 302);
  const previewUrl = upload.headers.get('location');
  const preview = await fetch(base + previewUrl, { headers: { cookie } });
  const previewHtml = await preview.text();
  assert.match(previewHtml, /전화번호 오류/);
  assert.match(previewHtml, /3건 등록/);

  const batchId = previewUrl.split('/').pop();
  const commit = await fetch(`${base}/admin/import/${batchId}/commit`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'schedule' }),
    redirect: 'manual',
  });
  assert.equal(commit.status, 302);
  assert.match(commit.headers.get('location'), /f=imported/);
  const db = getDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM projects WHERE order_number LIKE 'SK00%'").get().c, 3);
});

test('테스트 발송은 고객이 아닌 관리자 번호로만 나간다', async () => {
  const { cookie, csrf } = await login();
  const res = await fetch(`${base}/admin/test-send`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, phone: '010-9999-0000', type: 'FIRST' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /f=test_sent/);
  const message = getDb().prepare("SELECT * FROM messages WHERE message_type='TEST' ORDER BY message_id DESC").get();
  assert.equal(message.to_phone, '01099990000');
  assert.equal(message.project_id, null, '테스트 발송은 고객 주문에 기록되지 않는다');
});

test('사진 검수 · 리워드 저장', async () => {
  const { cookie, csrf } = await login();
  const db = getDb();
  const project = db.prepare("SELECT project_id FROM projects WHERE order_number='SK904'").get();
  const photo = db.prepare('SELECT * FROM photos WHERE project_id = ? LIMIT 1').get(project.project_id);

  const media = await fetch(`${base}/admin/media/${photo.photo_id}`, { headers: { cookie } });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/jpeg');

  await fetch(`${base}/admin/photos/${photo.photo_id}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, action: 'best' }),
    redirect: 'manual',
  });
  assert.equal(db.prepare('SELECT is_best FROM photos WHERE photo_id=?').get(photo.photo_id).is_best, 1);

  await fetch(`${base}/admin/projects/${project.project_id}/reward`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, amount_preset: '50000', status: 'PAID', memo: '우수 사례' }),
    redirect: 'manual',
  });
  const reward = db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(project.project_id);
  assert.equal(reward.amount, 50000);
  assert.equal(reward.status, 'PAID');
  assert.ok(reward.paid_at, '지급완료일 기록');
});

test('설정 저장: 리워드 금액·문구 유형·발송 한도', async () => {
  const { cookie, csrf } = await login();
  const res = await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf,
      consent_text: '사진 활용에 동의합니다.',
      privacy_text: '개인정보 안내',
      reward_criteria_text: '기준 설명',
      reward_max_amount: '50000',
      message_variant: 'reward',
      daily_send_limit: '30',
      min_photos: '2',
      max_photos: '8',
      send_hour_kst: '11',
      test_phone: '010-1111-2222',
    }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);

  const { getSetting } = require('../src/db');
  assert.equal(getSetting('message_variant'), 'reward');
  assert.equal(getSetting('daily_send_limit'), '30');

  // 문구 유형을 바꿔도 고객 화면의 리워드 안내는 그대로 유지된다
  const { token } = seedProject('SK909');
  const page = await (await fetch(`${base}/project/upload/${token}`)).text();
  assert.match(page, /최대 5만원/);

  // 원상 복구 (뒤따르는 테스트에 영향 없도록)
  await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf, consent_text: '사진 활용에 동의합니다.', privacy_text: '개인정보 안내',
      reward_criteria_text: '기준 설명', reward_max_amount: '50000',
      message_variant: 'info', daily_send_limit: '0', min_photos: '3', max_photos: '10',
      send_hour_kst: '10', test_phone: '',
    }),
    redirect: 'manual',
  });
});

test('로그아웃하면 세션이 무효화된다', async () => {
  const { cookie, csrf } = await login();
  await fetch(`${base}/admin/logout`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf }),
    redirect: 'manual',
  });
  const after = await fetch(`${base}/admin`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(after.status, 302);
});
