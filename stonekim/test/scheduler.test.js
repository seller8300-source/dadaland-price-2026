'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempData } = require('./helper');
useTempData('scheduler');

const { getDb } = require('../src/db');
const scheduler = require('../src/scheduler');
const { randomToken, nowIso, toDateString } = require('../src/util');

const db = getDb();

function createProject({ order, shipDate, installDate = null, excluded = 0 }) {
  db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)')
    .run('고객' + order, '0101111' + String(1000 + Number(order.slice(-3))).slice(-4), nowIso());
  const customerId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  db.prepare(
    `INSERT INTO projects (order_number, customer_id, ship_date, installation_date, upload_token,
       status, message_excluded, created_at, updated_at)
     VALUES (?,?,?,?,?, 'READY', ?, ?, ?)`
  ).run(order, customerId, shipDate, installDate, randomToken(), excluded, nowIso(), nowIso());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function messagesOf(projectId) {
  return db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY message_id').all(projectId);
}

test('시공예정일이 있으면 1차 메시지는 시공예정일 +2일에 예약된다', () => {
  const id = createProject({ order: 'SK101', shipDate: '2026-09-20', installDate: '2026-09-28' });
  scheduler.scheduleFirstMessage(id);
  const [message] = messagesOf(id);
  assert.equal(message.message_type, 'FIRST');
  assert.equal(message.status, 'SCHEDULED');
  assert.equal(toDateString(new Date(message.scheduled_at)), '2026-09-30');
});

test('시공예정일이 없으면 출고일 +14일에 예약된다', () => {
  const id = createProject({ order: 'SK102', shipDate: '2026-09-20' });
  scheduler.scheduleFirstMessage(id);
  const [message] = messagesOf(id);
  assert.equal(toDateString(new Date(message.scheduled_at)), '2026-10-04');
});

test('중복 예약은 생성되지 않는다', () => {
  const id = createProject({ order: 'SK103', shipDate: '2026-09-20' });
  scheduler.scheduleFirstMessage(id);
  scheduler.scheduleFirstMessage(id);
  assert.equal(messagesOf(id).length, 1);
});

test('발송 제외 주문은 예약되지 않는다', () => {
  const id = createProject({ order: 'SK104', shipDate: '2026-09-20', excluded: 1 });
  assert.equal(scheduler.scheduleFirstMessage(id), null);
  assert.equal(messagesOf(id).length, 0);
});

test('1차 발송 후 2차는 +7일, 2차 발송 후 최종은 +14일에 예약된다', async () => {
  const id = createProject({ order: 'SK105', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(id);

  await scheduler.processDue(new Date());
  let rows = messagesOf(id);
  assert.equal(rows.length, 2, '1차 발송 후 2차가 예약되어야 한다');
  assert.equal(rows[0].status, 'SENT');
  assert.equal(rows[0].channel, 'ALIMTALK');
  assert.equal(rows[1].message_type, 'SECOND');
  const firstSent = new Date(rows[0].sent_at);
  const secondAt = new Date(rows[1].scheduled_at);
  assert.equal(
    toDateString(secondAt),
    toDateString(new Date(firstSent.getTime() + 7 * 86400000)),
    '2차는 1차 발송 +7일'
  );
  assert.equal(db.prepare('SELECT status FROM projects WHERE project_id = ?').get(id).status, 'SENT_1');

  // 2차 예약 시각을 앞당겨 발송시키고 최종 예약을 확인
  db.prepare("UPDATE messages SET scheduled_at = ? WHERE message_id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), rows[1].message_id);
  await scheduler.processDue(new Date());
  rows = messagesOf(id);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].message_type, 'FINAL');
  const secondSent = new Date(rows[1].sent_at);
  assert.equal(
    toDateString(new Date(rows[2].scheduled_at)),
    toDateString(new Date(secondSent.getTime() + 14 * 86400000)),
    '최종은 2차 발송 +14일'
  );

  // 최종 발송 후에는 더 이상 예약되지 않는다
  db.prepare("UPDATE messages SET scheduled_at = ? WHERE message_id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), rows[2].message_id);
  await scheduler.processDue(new Date());
  rows = messagesOf(id);
  assert.equal(rows.length, 3, '최종 발송 이후 자동 요청 종료');
  assert.equal(db.prepare('SELECT status FROM projects WHERE project_id = ?').get(id).status, 'SENT_FINAL');
});

test('사진이 등록되면 예약된 메시지가 모두 취소된다 (절대 조건)', async () => {
  const id = createProject({ order: 'SK106', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(id);
  await scheduler.processDue(new Date());
  assert.equal(messagesOf(id).filter((m) => m.status === 'SCHEDULED').length, 1);

  db.prepare('INSERT INTO photos (project_id, file_url, created_at) VALUES (?,?,?)')
    .run(id, 'x.jpg', nowIso());
  const canceled = scheduler.onPhotoSubmitted(id);

  assert.equal(canceled, 1);
  const rows = messagesOf(id);
  assert.equal(rows.filter((m) => m.status === 'SCHEDULED').length, 0);
  assert.equal(rows.find((m) => m.message_type === 'SECOND').status, 'CANCELED_PHOTO');
  assert.equal(db.prepare('SELECT status FROM projects WHERE project_id = ?').get(id).status, 'PHOTO_SUBMITTED');
  assert.ok(db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(id), '리워드 검토 행 생성');

  // 취소 이후 어떤 처리에서도 다시 발송되지 않는다
  await scheduler.processDue(new Date());
  assert.equal(messagesOf(id).filter((m) => m.status === 'SENT').length, 1);
});

test('예약 시각이 지나도 사진이 있으면 발송되지 않고 취소된다', async () => {
  const id = createProject({ order: 'SK107', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(id);
  db.prepare('INSERT INTO photos (project_id, file_url, created_at) VALUES (?,?,?)').run(id, 'y.jpg', nowIso());

  await scheduler.processDue(new Date());
  const rows = messagesOf(id);
  assert.equal(rows[0].status, 'CANCELED_PHOTO');
  assert.equal(rows[0].sent_at, null);
});

test('발송 제외로 전환되면 예약 메시지가 중단된다', async () => {
  const id = createProject({ order: 'SK108', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(id);
  db.prepare('UPDATE projects SET message_excluded = 1 WHERE project_id = ?').run(id);
  await scheduler.processDue(new Date());
  assert.equal(messagesOf(id)[0].status, 'CANCELED_ADMIN');
});

test('알림톡 실패 시 SMS/LMS 로 대체발송된다', async () => {
  process.env.STONEKIM_MOCK_ALIMTALK_FAIL_RATE = '1';
  const id = createProject({ order: 'SK109', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(id);
  await scheduler.processDue(new Date());
  const [message] = messagesOf(id);
  assert.equal(message.status, 'SENT_SMS');
  assert.equal(message.channel, 'LMS', '본문이 90바이트를 넘으므로 LMS');
  assert.match(message.failure_reason, /알림톡 실패/);
  delete process.env.STONEKIM_MOCK_ALIMTALK_FAIL_RATE;
});

test('관리자 즉시 발송', async () => {
  const id = createProject({ order: 'SK110', shipDate: '2026-12-01' });
  scheduler.scheduleFirstMessage(id);
  const result = await scheduler.sendNow(id, 'FIRST');
  assert.equal(result.ok, true);
  assert.equal(result.sent, 'SENT');
  const rows = messagesOf(id);
  assert.equal(rows.filter((m) => m.message_type === 'FIRST' && m.status === 'SENT').length, 1);
  assert.equal(rows.filter((m) => m.message_type === 'SECOND' && m.status === 'SCHEDULED').length, 1);
});

test('일일 발송 한도를 넘으면 나머지는 예약 상태로 남는다 (소규모 오픈 안전장치)', async () => {
  const { setSetting } = require('../src/db');
  const a = createProject({ order: 'SK111', shipDate: '2020-01-01', installDate: '2020-01-02' });
  const b = createProject({ order: 'SK112', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(a);
  scheduler.scheduleFirstMessage(b);

  setSetting('daily_send_limit', scheduler.sentToday() + 1);
  await scheduler.processDue(new Date());

  const firstOf = (id) => messagesOf(id).find((m) => m.message_type === 'FIRST');
  const sent = [a, b].filter((id) => firstOf(id).status === 'SENT');
  const pending = [a, b].filter((id) => firstOf(id).status === 'SCHEDULED');
  assert.equal(sent.length, 1, '한도만큼만 발송된다');
  assert.equal(pending.length, 1, '나머지는 취소되지 않고 예약 상태로 남는다');

  // 한도를 풀면 남은 건이 발송된다
  setSetting('daily_send_limit', 0);
  await scheduler.processDue(new Date());
  assert.equal([a, b].filter((id) => firstOf(id).status === 'SENT').length, 2);
});

test('발송 허용 번호가 있으면 그 번호에만 발송된다 (실전 테스트 안전장치)', async () => {
  const { setSetting } = require('../src/db');
  const mine = createProject({ order: 'SK121', shipDate: '2020-01-01', installDate: '2020-01-02' });
  const other = createProject({ order: 'SK122', shipDate: '2020-01-01', installDate: '2020-01-02' });
  scheduler.scheduleFirstMessage(mine);
  scheduler.scheduleFirstMessage(other);

  const myPhone = db
    .prepare('SELECT c.phone FROM projects p JOIN customers c ON c.customer_id = p.customer_id WHERE p.project_id = ?')
    .get(mine).phone;
  setSetting('send_allowlist', myPhone);

  await scheduler.processDue(new Date());

  const firstOf = (id) => messagesOf(id).find((m) => m.message_type === 'FIRST');
  assert.equal(firstOf(mine).status, 'SENT', '허용된 번호는 발송된다');
  assert.equal(firstOf(other).status, 'SCHEDULED', '그 외 번호는 발송되지 않는다');
  assert.equal(firstOf(other).sent_at, null);

  // 관리자가 수동 발송해도 허용 목록 밖이면 막는다
  const manual = await scheduler.sendNow(other, 'FIRST');
  assert.equal(manual.ok, false);
  assert.match(manual.error, /발송 허용 번호/);

  // 허용 목록을 비우면 다시 발송된다 (예약은 그대로 살아 있다)
  setSetting('send_allowlist', '');
  await scheduler.processDue(new Date());
  assert.equal(firstOf(other).status, 'SENT');
});

test('메시지 본문에 고유 업로드 링크가 포함된다', () => {
  const templates = require('../src/templates');
  const reward = require('../src/reward');
  const link = 'http://test.local/project/upload/abc';

  const info = templates.buildBody('FIRST', link, reward.current(), 'info');
  assert.match(info, /http:\/\/test\.local\/project\/upload\/abc/);
  assert.doesNotMatch(info, /만원/, '정보성 문구에는 금액을 쓰지 않는다');

  const withReward = templates.buildBody('FIRST', link, reward.current(), 'reward');
  assert.match(withReward, /http:\/\/test\.local\/project\/upload\/abc/);
  assert.match(withReward, /확인 후 최대 5만원/);
});
