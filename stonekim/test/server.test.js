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

/** 관리자 외 계정으로 로그인 (직원은 설정 화면을 못 열기 때문에 대시보드에서 csrf 를 읽는다) */
async function loginAs(username, password) {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302, `${username} 로그인 실패`);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const html = await (await fetch(`${base}/admin/password`, { headers: { cookie } })).text();
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
  assert.match(html, /김고객 고객님/);
  assert.match(html, /주문내역/);
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
  const { body, contentType } = buildMultipart({ consent: '1', contractor: '스톤인테리어' }, [
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
  const { body, contentType } = buildMultipart({ consent: '1', contractor: '스톤인테리어', region: '대전 유성' },
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
    const { body, contentType } = buildMultipart({ consent: '1', contractor: '스톤인테리어' },
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
  const db = getDb();
  const message = db.prepare("SELECT * FROM messages WHERE message_type='TEST' ORDER BY message_id DESC").get();
  assert.equal(message.to_phone, '01099990000');

  // 테스트 발송이 보낸 링크는 실제로 열려야 한다 ('유효하지 않은 링크'가 아니어야 한다)
  const project = db.prepare("SELECT * FROM projects WHERE order_number = 'TEST-01099990000'").get();
  assert.ok(project, '테스트 발송용 주문이 만들어진다');
  assert.equal(project.message_excluded, 1, '테스트 주문은 자동 발송에서 제외된다');
  assert.equal(message.project_id, project.project_id);
  assert.ok(message.body.includes(project.upload_token), '메시지 본문에 실제 토큰이 들어간다');

  const page = await fetch(`${base}/project/upload/${project.upload_token}`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.doesNotMatch(pageHtml, /유효하지 않은 링크/);

  // 같은 번호로 다시 테스트해도 주문은 하나만 쌓인다
  await fetch(`${base}/admin/test-send`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, phone: '010-9999-0000', type: 'FIRST' }),
    redirect: 'manual',
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM projects WHERE order_number LIKE 'TEST-%'").get().c,
    1
  );
});

test('발송 허용 번호가 걸려 있으면 테스트 발송도 막힌다', async () => {
  const { cookie, csrf } = await login();
  const { setSetting } = require('../src/db');
  setSetting('send_allowlist', '01038227444');

  const blocked = await fetch(`${base}/admin/test-send`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, phone: '010-7769-7444', type: 'FIRST' }),
    redirect: 'manual',
  });
  assert.match(blocked.headers.get('location'), /f=test_not_allowed/);

  const allowed = await fetch(`${base}/admin/test-send`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, phone: '010-3822-7444', type: 'FIRST' }),
    redirect: 'manual',
  });
  assert.match(allowed.headers.get('location'), /f=test_sent/);

  setSetting('send_allowlist', '');
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
      reward_headline: '사진 등록하고 상품권 받기',
      reward_benefits: '등록 고객 100% 3만원',
      brand_logo_url: 'https://stonekim.kr/logo.png',
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
  assert.equal(getSetting('brand_logo_url'), 'https://stonekim.kr/logo.png');

  // 저장한 혜택 문구와 로고가 고객 화면에 그대로 반영된다
  const { token } = seedProject('SK909');
  const page = await (await fetch(`${base}/project/upload/${token}`)).text();
  assert.match(page, /사진 등록하고 상품권 받기/);
  assert.match(page, /등록 고객 100% 3만원/);
  assert.match(page, /stonekim\.kr\/logo\.png/);

  // 원상 복구 (뒤따르는 테스트에 영향 없도록)
  await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf, consent_text: '사진 활용에 동의합니다.', privacy_text: '개인정보 안내',
      reward_criteria_text: '기준 설명', reward_headline: '사진 등록 안내', reward_benefits: '혜택',
      brand_logo_url: '', message_variant: 'info', daily_send_limit: '0', min_photos: '3', max_photos: '10',
      send_hour_kst: '10', test_phone: '',
    }),
    redirect: 'manual',
  });
});

test('환경변수로 지정한 관리자 비밀번호는 로그에 남기지 않는다', () => {
  const { bootstrap } = require('../server');
  const auth = require('../src/auth');
  const { getDb } = require('../src/db');

  // 계정을 지워 최초 기동 상황을 재현한다
  const saved = getDb().prepare('SELECT * FROM admin_users WHERE username = ?').get('admin');
  getDb().prepare('DELETE FROM admin_users WHERE username = ?').run('admin');

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    bootstrap();
  } finally {
    console.log = original;
  }

  const output = lines.join('\n');
  assert.match(output, /최초 관리자 계정이 생성되었습니다/);
  assert.doesNotMatch(output, /test-password-1234/, '지정한 비밀번호가 로그에 노출되면 안 된다');
  assert.match(output, /환경변수 STONEKIM_ADMIN_PASSWORD/);

  // 로그인은 여전히 환경변수 비밀번호로 가능해야 한다
  assert.ok(auth.login('admin', 'test-password-1234', '127.0.0.1'));
  assert.ok(saved, '기존 계정 정보가 있었다');
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


test('직원 계정: 관리자가 만들고 · 첫 로그인에 비밀번호를 바꾸고 · 설정에는 못 들어간다', async () => {
  const { cookie, csrf } = await login();

  const created = await fetch(`${base}/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, username: 'younghee', display_name: '김영희', role: 'STAFF' }),
  });
  assert.equal(created.status, 200);
  const temporary = (await created.text()).match(/letter-spacing:1px">([^<]+)</)[1];

  // 임시 비밀번호로 들어오면 비밀번호를 바꾸기 전까지 어느 화면도 못 연다
  const first = await loginAs('younghee', temporary);
  const blocked = await fetch(`${base}/admin/review`, { headers: { cookie: first.cookie }, redirect: 'manual' });
  assert.equal(blocked.status, 302);
  assert.match(blocked.headers.get('location'), /\/admin\/password/);

  const changed = await fetch(`${base}/admin/password`, {
    method: 'POST',
    headers: { cookie: first.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: first.csrf, current: temporary, next: 'staff-pass-99', confirm: 'staff-pass-99' }),
    redirect: 'manual',
  });
  assert.match(changed.headers.get('location'), /password_changed/);

  const staff = await loginAs('younghee', 'staff-pass-99');
  for (const path of ['/admin', '/admin/projects', '/admin/review', '/admin/rewards', '/admin/messages', '/admin/import']) {
    const res = await fetch(base + path, { headers: { cookie: staff.cookie } });
    assert.equal(res.status, 200, `${path} 은 직원도 쓸 수 있어야 한다`);
  }

  // 설정·계정 관리는 직원에게 잠겨 있다 (허용 번호를 직원이 풀면 전 고객에게 나간다)
  const settings = await fetch(`${base}/admin/settings`, { headers: { cookie: staff.cookie }, redirect: 'manual' });
  assert.equal(settings.status, 302);
  assert.match(settings.headers.get('location'), /f=forbidden/);

  const clearAllowlist = await fetch(`${base}/admin/settings`, {
    method: 'POST',
    headers: { cookie: staff.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: staff.csrf, send_allowlist: '' }),
    redirect: 'manual',
  });
  assert.equal(clearAllowlist.status, 403, '직원은 발송 허용 번호를 건드릴 수 없다');

  const makeUser = await fetch(`${base}/admin/users`, {
    method: 'POST',
    headers: { cookie: staff.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: staff.csrf, username: 'sneaky' }),
    redirect: 'manual',
  });
  assert.equal(makeUser.status, 403);

  const home = await (await fetch(`${base}/admin`, { headers: { cookie: staff.cookie } })).text();
  assert.doesNotMatch(home, /href="\/admin\/settings"/, '메뉴에도 설정이 보이지 않는다');
  assert.doesNotMatch(home, /href="\/admin\/users"/);
});

test('계정을 중지하면 로그인되어 있던 세션까지 끊긴다', async () => {
  const { cookie, csrf } = await login();
  const created = await fetch(`${base}/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, username: 'temphand', display_name: '단기', role: 'STAFF' }),
  });
  const temporary = (await created.text()).match(/letter-spacing:1px">([^<]+)</)[1];
  const staff = await loginAs('temphand', temporary);
  const userId = getDb().prepare("SELECT user_id FROM admin_users WHERE username='temphand'").get().user_id;

  const off = await fetch(`${base}/admin/users/${userId}/active`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, value: '0' }),
    redirect: 'manual',
  });
  assert.match(off.headers.get('location'), /user_disabled/);

  const after = await fetch(`${base}/admin/password`, { headers: { cookie: staff.cookie }, redirect: 'manual' });
  assert.equal(after.status, 302);
  assert.match(after.headers.get('location'), /\/admin\/login/);

  const relogin = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'temphand', password: temporary }),
    redirect: 'manual',
  });
  assert.equal(relogin.status, 401, '중지된 계정은 다시 로그인되지 않는다');
});


test('비상 복구: STONEKIM_ADMIN_RESET 으로 관리자 비밀번호를 되돌린다', () => {
  const auth = require('../src/auth');
  const db = getDb();

  // 비밀번호를 잊고, 계정까지 잠긴 최악의 상황을 만든다
  const before = db.prepare("SELECT user_id FROM admin_users WHERE username = 'admin'").get();
  auth.changePassword(before.user_id, '기억나지-않는-비밀번호');
  db.prepare("UPDATE admin_users SET active = 0, role = 'STAFF' WHERE user_id = ?").run(before.user_id);
  assert.equal(auth.login('admin', 'test-password-1234', '127.0.0.1'), null);

  // 스위치가 꺼져 있으면 아무 일도 없어야 한다
  delete process.env.STONEKIM_ADMIN_RESET;
  assert.equal(auth.resetBootstrapPassword(), null);

  process.env.STONEKIM_ADMIN_RESET = '1';
  process.env.STONEKIM_ADMIN_USER = 'admin';
  process.env.STONEKIM_ADMIN_PASSWORD = 'test-password-1234';
  const result = auth.resetBootstrapPassword();
  assert.equal(result.username, 'admin');

  const session = auth.login('admin', 'test-password-1234', '127.0.0.1');
  assert.ok(session, '환경변수 비밀번호로 다시 들어갈 수 있어야 한다');
  assert.equal(session.user.role, 'OWNER', '권한도 관리자로 되돌아간다');
  assert.equal(session.user.active, 1, '잠겨 있던 계정도 풀린다');

  // 데이터는 건드리지 않는다
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM projects').get().c > 0, '주문 데이터는 그대로다');

  delete process.env.STONEKIM_ADMIN_RESET;
  auth.logout(session.token);
});


test('주문 수기 등록: 고객명·번호만으로 등록되고 1차가 예약된다', async () => {
  const { cookie, csrf } = await login();
  const db = getDb();

  const page = await fetch(`${base}/admin/projects/new`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /주문 직접 등록/);

  const created = await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf, mode: 'schedule',
      customer_name: '전화주문고객', phone: '010-2468-1357',
      ship_date: '2026-10-02', installation_date: '2026-10-20',
      product: '칼라카타 600×1200', site_name: '전화 현장',
    }),
    redirect: 'manual',
  });
  assert.equal(created.status, 302);
  assert.match(created.headers.get('location'), /f=manual_created/);

  // 주문번호를 비웠으므로 자동으로 만들어진다
  const project = db
    .prepare("SELECT * FROM projects WHERE order_number LIKE 'M20261002-%' ORDER BY project_id DESC")
    .get();
  assert.ok(project, '주문번호가 자동 생성된다');
  assert.equal(project.installation_date, '2026-10-20');
  assert.equal(project.message_excluded, 0);

  // 시공예정일 +2일로 1차가 잡힌다
  const message = db
    .prepare("SELECT * FROM messages WHERE project_id = ? AND message_type = 'FIRST'")
    .get(project.project_id);
  assert.equal(message.status, 'SCHEDULED');
  assert.match(message.scheduled_at, /^2026-10-22/);

  // 고객 화면 링크가 실제로 열려야 한다
  const upload = await fetch(`${base}/project/upload/${project.upload_token}`);
  assert.equal(upload.status, 200);
  assert.match(await upload.text(), /전화주문고객/);
});

test('주문 수기 등록: 번호가 틀리면 입력값을 그대로 돌려주며 막는다', async () => {
  const { cookie, csrf } = await login();
  const res = await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'schedule', customer_name: '김영희', phone: '1234' }),
  });
  assert.equal(res.status, 200, '등록되지 않고 입력 화면이 다시 뜬다');
  const html = await res.text();
  assert.match(html, /휴대폰번호 형식이 올바르지 않습니다/);
  assert.match(html, /value="김영희"/, '쳐 둔 값은 남아 있어야 한다');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM customers WHERE name='김영희'").get().c, 0);
});

test('주문 수기 등록: 발송 보류로 넣으면 예약이 잡히지 않는다', async () => {
  const { cookie, csrf } = await login();
  await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf, mode: 'hold', order_number: 'MANUAL-HOLD-1',
      customer_name: '보류고객', phone: '010-1357-2468', ship_date: '2026-10-02',
    }),
    redirect: 'manual',
  });
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE order_number = 'MANUAL-HOLD-1'").get();
  assert.equal(project.message_excluded, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ?").get(project.project_id).c,
    0
  );
});


/* ------------------------------------------------- 운영 피드백 반영분 */

test('시공업체명은 필수 — 비우면 사진이 등록되지 않는다', async () => {
  const { token, projectId } = seedProject('SK930');
  const { body, contentType } = buildMultipart({ consent: '1' },
    [1, 2, 3].map((i) => ({ field: 'photos', filename: `c${i}.jpg`, data: jpegBytes(300) })));
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body,
  });
  assert.match(await res.text(), /시공업체명을 입력해 주세요/);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?').get(projectId).c, 0);
});

test('상품권 받을 번호를 따로 적으면 그 번호가 보관된다', async () => {
  const { token, projectId } = seedProject('SK931');
  const { body, contentType } = buildMultipart(
    { consent: '1', contractor: '다른회사인테리어', venue_name: '카페 스톤',
      reward_phone: '010-5555-6666', show_name_consent: '1' },
    [1, 2, 3].map((i) => ({ field: 'photos', filename: `r${i}.jpg`, data: jpegBytes(300) })));
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body, redirect: 'manual',
  });
  assert.equal(res.status, 302);

  const project = getDb().prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
  assert.equal(project.reward_phone, '01055556666', '발송 번호와 다른 번호가 저장된다');
  assert.equal(project.contractor, '다른회사인테리어');
  assert.equal(project.venue_name, '카페 스톤');
  assert.equal(project.show_name_consent, 1, '이름 노출 희망이 기록된다');
});

test('상품권 번호 형식이 틀리면 등록을 막는다', async () => {
  const { token, projectId } = seedProject('SK932');
  const { body, contentType } = buildMultipart(
    { consent: '1', contractor: '스톤인테리어', reward_phone: '12345' },
    [1, 2, 3].map((i) => ({ field: 'photos', filename: `b${i}.jpg`, data: jpegBytes(300) })));
  const res = await fetch(`${base}/project/upload/${token}`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body,
  });
  assert.match(await res.text(), /상품권 받을 번호 형식/);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM photos WHERE project_id = ?').get(projectId).c, 0);
});

test('발송 제외 명단에 걸리면 등록은 되지만 자동 발송에서 빠진다', async () => {
  const { cookie, csrf } = await login();
  const { setSetting } = require('../src/db');
  setSetting('exclude_list', '010-7777-8888\n대리점');

  // 번호로 걸리는 경우
  await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'schedule', order_number: 'EXC-PHONE',
      customer_name: '파트너사', phone: '010-7777-8888', ship_date: '2026-10-02' }),
    redirect: 'manual',
  });
  // 업체명으로 걸리는 경우
  await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'schedule', order_number: 'EXC-NAME',
      customer_name: '서울대리점', phone: '010-7777-9999', ship_date: '2026-10-02' }),
    redirect: 'manual',
  });
  // 안 걸리는 경우
  await fetch(`${base}/admin/projects/new`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'schedule', order_number: 'EXC-NONE',
      customer_name: '일반고객', phone: '010-7777-0000', ship_date: '2026-10-02' }),
    redirect: 'manual',
  });

  const db = getDb();
  for (const [orderNumber, shouldExclude] of [['EXC-PHONE', true], ['EXC-NAME', true], ['EXC-NONE', false]]) {
    const project = db.prepare('SELECT * FROM projects WHERE order_number = ?').get(orderNumber);
    assert.equal(project.message_excluded, shouldExclude ? 1 : 0, `${orderNumber} 제외 여부`);
    const scheduled = db
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND status = 'SCHEDULED'")
      .get(project.project_id).c;
    assert.equal(scheduled, shouldExclude ? 0 : 1, `${orderNumber} 예약 여부`);
    if (shouldExclude) assert.match(project.excluded_reason, /발송 제외 명단/);
  }
  setSetting('exclude_list', '');
});

test('같은 번호로 최근에 보냈으면 1차를 다시 보내지 않는다', async () => {
  const db = getDb();
  const { setSetting } = require('../src/db');
  const scheduler = require('../src/scheduler');
  setSetting('dedupe_days', '30');
  setSetting('send_allowlist', '');

  const importer = require('../src/import');
  const first = importer.createManualProject({
    order_number: 'DUP-1', customer_name: '중복업체', phone: '010-4444-5555', ship_date: '2026-10-02',
  });
  const second = importer.createManualProject({
    order_number: 'DUP-2', customer_name: '중복업체', phone: '010-4444-5555', ship_date: '2026-10-02',
  });
  assert.ok(first.ok && second.ok);

  // 첫 건은 정상 발송
  const sent = await scheduler.sendNow(first.project_id, 'FIRST');
  assert.equal(sent.ok, true);

  // 두 번째 건은 예약 시각이 와도 건너뛴다
  db.prepare("UPDATE messages SET scheduled_at = ? WHERE project_id = ? AND status = 'SCHEDULED'")
    .run(new Date(Date.now() - 60000).toISOString(), second.project_id);
  const results = await scheduler.processDue(new Date());
  assert.ok(results.some((r) => r.skipped === 'DUPLICATE_RECENT'), '중복으로 건너뛴다');

  const stillScheduled = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND status = 'SCHEDULED'")
    .get(second.project_id).c;
  assert.equal(stillScheduled, 0, '예약은 남겨두지 않고 취소된다');

  // 기간을 0 으로 두면 중복 발송을 허용한다
  setSetting('dedupe_days', '0');
  assert.equal(scheduler.recentSendTo('01044445555'), null);
  setSetting('dedupe_days', '30');
});


test('등록 완료 화면은 금액을 다시 홍보하지 않고 받는 방법만 알려준다', async () => {
  const { setSetting } = require('../src/db');
  setSetting('done_notice', '백화점 상품권은 영업일 기준 5~14일 이내 순차 발송해 드립니다.\n베스트 시공 사례로 선정되시면 담당자가 따로 연락드리겠습니다.');

  const { token } = seedProject('SK940');
  const { body, contentType } = buildMultipart(
    { consent: '1', contractor: '스톤인테리어' },
    [1, 2, 3].map((i) => ({ field: 'photos', filename: `d${i}.jpg`, data: jpegBytes(300) })));
  await fetch(`${base}/project/upload/${token}`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body, redirect: 'manual',
  });

  const html = await (await fetch(`${base}/project/upload/${token}/done`)).text();
  assert.match(html, /5~14일 이내 순차 발송/);
  assert.match(html, /베스트 시공 사례로 선정되시면/);
  assert.match(html, /등록된 사진 3장/);
  // 이미 등록을 끝낸 고객에게 금액을 다시 들이밀지 않는다
  assert.doesNotMatch(html, /3만원/);
  assert.doesNotMatch(html, /사진만 등록하셔도/);
});

test('고객 화면에 필수·선택 표시와 전화번호 입력 제한이 들어간다', async () => {
  const { token } = seedProject('SK941');
  const html = await (await fetch(`${base}/project/upload/${token}`)).text();

  assert.match(html, /업체명·업장명을 함께 소개해 주세요\. <em class="opt">\(선택\)<\/em>/);
  assert.match(html, /<b class="req">\(필수\)<\/b>/);
  // 상품권 번호: 11자리(하이픈 포함 13자) 제한 + 가득 찬 너비
  assert.match(html, /id="reward_phone"[^>]*maxlength="13"/);
  assert.match(html, /id="reward_phone"[^>]*placeholder="010-0000-0000"/);
  // 사진 장수 초과 안내를 띄울 자리
  assert.match(html, /id="picknote"/);
});
