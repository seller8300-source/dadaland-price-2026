'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempData } = require('./helper');
useTempData('spec');

const { getDb, setSetting } = require('../src/db');
const spec = require('../src/spec');
const scheduler = require('../src/scheduler');
const importer = require('../src/import');
const templates = require('../src/templates');
const { toDateString, dateStringPlusDays } = require('../src/util');

function today(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return toDateString(d);
}

test('품목코드로 제품군을 찾는다', () => {
  setSetting('spec_groups', 'SF=소프트스톤\nIP=콕스톤');

  assert.equal(spec.groupFor('[SF]S-K052_1 [1200*3100] 외 2건'), '소프트스톤');
  assert.equal(spec.groupFor('[SF20-2]T-A015 [600*1200]'), '소프트스톤', 'SF 변형도 같이 걸린다');
  assert.equal(spec.groupFor('[SF29] S-K035 [1135*2998]'), '소프트스톤');
  assert.equal(spec.groupFor('IP-F7230 [1220*2440*5mm]'), '콕스톤');
  // 어느 코드도 안 걸리면 두루뭉술하게 나간다 (알림톡 변수는 비우면 발송 실패)
  assert.equal(spec.groupFor('MP-A009 [1220X2440*5MM]'), '주문하신 제품');
  assert.equal(spec.groupFor(''), '주문하신 제품');
});

test('긴 코드를 먼저 봐서 예외를 따로 둘 수 있다', () => {
  setSetting('spec_groups', 'SF=소프트스톤\nSF29=특수스톤');
  assert.equal(spec.groupFor('[SF29] S-K035'), '특수스톤', 'SF29 가 SF 보다 이긴다');
  assert.equal(spec.groupFor('[SF]S-K052_1'), '소프트스톤');
  setSetting('spec_groups', 'SF=소프트스톤\nIP=콕스톤');
});

test('한 전표에 제품군이 섞이면 둘 다 알려준다', () => {
  setSetting('spec_groups', 'SF=소프트스톤\nIP=콕스톤');
  assert.equal(spec.groupFor('[SF]S-K052 외 IP-F7230'), '소프트스톤, 콕스톤');
});

test('링크가 없으면 켜 두어도 발송하지 않는다', () => {
  setSetting('spec_enabled', '1');
  setSetting('spec_link', '');
  assert.equal(spec.enabled(), false);
  setSetting('spec_link', 'https://stonekim.kr/spec');
  assert.equal(spec.enabled(), true);
});

test('앞으로 출고될 건에만 시방서를 예약한다', () => {
  setSetting('spec_enabled', '1');
  setSetting('spec_link', 'https://stonekim.kr/spec');
  const db = getDb();

  const future = importer.createManualProject({
    order_number: 'SPEC-FUTURE', customer_name: '앞으로출고', phone: '010-1000-2000',
    ship_date: today(7), product: '[SF]S-K052_1 [1200*3100]',
  });
  const past = importer.createManualProject({
    order_number: 'SPEC-PAST', customer_name: '이미출고', phone: '010-1000-3000',
    ship_date: today(-7), product: '[SF]S-K052_1 [1200*3100]',
  });
  assert.equal(future.spec_guided, true);
  assert.equal(past.spec_guided, false, '지난 출고건은 이미 시공이 끝났을 수 있다');

  const guideCount = (projectId) =>
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND message_type = 'GUIDE'")
      .get(projectId).c;
  assert.equal(guideCount(future.project_id), 1);
  assert.equal(guideCount(past.project_id), 0);

  // 사진 요청(1차)은 지난 출고건에도 정상적으로 잡힌다
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND message_type = 'FIRST'")
      .get(past.project_id).c,
    1
  );
});

test('오늘 출고 건은 보낸다 (경계)', () => {
  const result = importer.createManualProject({
    order_number: 'SPEC-TODAY', customer_name: '오늘출고', phone: '010-1000-4000',
    ship_date: today(0), product: '[SF]S-S013',
  });
  assert.equal(result.spec_guided, true);
});

test('시방서 기능이 꺼져 있으면 예약하지 않는다', () => {
  setSetting('spec_enabled', '0');
  const result = importer.createManualProject({
    order_number: 'SPEC-OFF', customer_name: '꺼짐', phone: '010-1000-5000',
    ship_date: today(7), product: '[SF]S-S013',
  });
  assert.equal(result.spec_guided, false);
  setSetting('spec_enabled', '1');
});

test('발송 보류·제외 건에는 시방서도 안 나간다', () => {
  const held = importer.createManualProject({
    order_number: 'SPEC-HOLD', customer_name: '보류', phone: '010-1000-6000',
    ship_date: today(7), product: '[SF]S-S013',
  }, { hold: true });
  assert.equal(held.spec_guided, false);

  setSetting('exclude_list', '010-1000-7000');
  const excluded = importer.createManualProject({
    order_number: 'SPEC-EXC', customer_name: '대리점', phone: '010-1000-7000',
    ship_date: today(7), product: '[SF]S-S013',
  });
  assert.equal(excluded.spec_guided, false);
  setSetting('exclude_list', '');
});

test('시방서 본문에 제품군과 링크가 들어간다', () => {
  const body = templates.guide('https://stonekim.kr/spec', '소프트스톤');
  assert.match(body, /시방서 종류: 소프트스톤/);
  assert.match(body, /https:\/\/stonekim\.kr\/spec/);
  assert.match(body, /1866-1338/);
  // 시방서는 정보성이라 금액·혜택이 들어가면 안 된다 (알림톡 심사 반려 사유)
  assert.doesNotMatch(body, /상품권|리워드|만원/);
});

test('시방서는 사진 요청과 섞이지 않는다', async () => {
  setSetting('send_allowlist', '');
  const db = getDb();
  setSetting('spec_groups', 'SF=소프트스톤\nIP=콕스톤');
  const made = importer.createManualProject({
    order_number: 'SPEC-FLOW', customer_name: '흐름확인', phone: '010-1000-8000',
    ship_date: today(3), product: 'IP-F7230',
  });

  const sent = await scheduler.sendNow(made.project_id, 'GUIDE');
  assert.equal(sent.ok, true);

  const guide = db
    .prepare("SELECT * FROM messages WHERE project_id = ? AND message_type = 'GUIDE'")
    .get(made.project_id);
  assert.match(guide.body, /콕스톤/, '제품군이 본문에 들어간다');
  assert.match(guide.body, /stonekim\.kr\/spec/, '사진 업로드 링크가 아니라 시방서 링크가 들어간다');
  assert.doesNotMatch(guide.body, /project\/upload/);

  // 시방서를 보냈다고 2차가 예약되면 안 된다
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND message_type = 'SECOND'")
      .get(made.project_id).c,
    0,
    '시방서는 후속 단계를 만들지 않는다'
  );
  // 1차 사진 요청은 그대로 예약돼 있다
  assert.equal(
    db.prepare("SELECT status FROM messages WHERE project_id = ? AND message_type = 'FIRST'")
      .get(made.project_id).status,
    'SCHEDULED'
  );
});
