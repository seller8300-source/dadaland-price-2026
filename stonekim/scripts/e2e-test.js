'use strict';
/**
 * 대표님 번호 1개로만 전체 흐름을 확인하는 실전 테스트 도구.
 * setup 을 실행하면 '발송 허용 번호'가 그 번호로 고정되므로, 테스트 중 고객에게는 한 건도 나가지 않는다.
 *
 *   node scripts/e2e-test.js setup 010-1234-5678   테스트 주문 생성 + 허용번호 고정 + 링크 출력
 *   node scripts/e2e-test.js send                  1차 알림톡 즉시 발송
 *   node scripts/e2e-test.js status                진행 상황 체크리스트
 *   node scripts/e2e-test.js cleanup               테스트 주문 삭제 + 허용번호 유지
 *   node scripts/e2e-test.js open                  허용번호 해제 (실제 운영 시작 시에만)
 */
const { getDb, getSetting, setSetting, audit } = require('../src/db');
const scheduler = require('../src/scheduler');
const photos = require('../src/photos');
const messaging = require('../src/messaging');
const { normalizePhone, formatPhone, randomToken, nowIso, toDateString, fmtDateTime } = require('../src/util');

const TEST_PREFIX = 'TEST-';
const TYPE_LABEL = { FIRST: '1차', SECOND: '2차', FINAL: '최종', TEST: '테스트', MANUAL: '수동' };
const STATUS_LABEL = {
  SCHEDULED: '예약', SENT: '발송완료', SENT_SMS: 'SMS 대체발송', FAILED: '발송실패',
  CANCELED_PHOTO: '사진등록으로 취소', CANCELED_ADMIN: '관리자 중단',
};

const db = getDb();
const command = (process.argv[2] || 'status').toLowerCase();

function latestTestProject() {
  return db
    .prepare(
      `SELECT p.*, c.name AS customer_name, c.phone
         FROM projects p JOIN customers c ON c.customer_id = p.customer_id
        WHERE p.order_number LIKE ? ORDER BY p.project_id DESC LIMIT 1`
    )
    .get(`${TEST_PREFIX}%`);
}

function mark(ok) { return ok ? '✓' : '·'; }

function setup(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.error('\n휴대폰번호를 정확히 넣어주세요. 예) node scripts/e2e-test.js setup 010-1234-5678\n');
    process.exit(1);
  }

  // 1) 이 번호에만 발송되도록 고정 (가장 중요한 안전장치)
  setSetting('send_allowlist', phone);

  // 2) 어제 시공 완료된 것처럼 주문을 만든다 → 1차 발송 대상
  const today = toDateString(new Date());
  const orderNumber = `${TEST_PREFIX}${today.replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!customer) {
    db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)')
      .run('대표님 테스트', phone, nowIso());
    customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  }
  const token = randomToken();
  db.prepare(
    `INSERT INTO projects (order_number, customer_id, product, quantity, ship_date, installation_date,
        site_name, region, sales_manager, upload_token, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'READY', ?, ?)`
  ).run(
    orderNumber, customer.customer_id, '칼라카타 600×2400 (테스트)', '1EA',
    today, toDateString(new Date(Date.now() - 86400000)), '실전 테스트 현장', '테스트',
    '테스트', token, nowIso(), nowIso()
  );
  const projectId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  scheduler.scheduleFirstMessage(projectId);
  audit({ user_id: null, username: 'e2e-script' }, 'E2E_SETUP', orderNumber, phone, 'localhost');

  console.log('\n■ 실전 테스트 준비 완료');
  console.log(`  주문번호     : ${orderNumber}`);
  console.log(`  수신번호     : ${formatPhone(phone)}`);
  console.log(`  발송 허용    : ${formatPhone(phone)} 1개 (다른 고객에게는 발송되지 않습니다)`);
  console.log(`  발송 채널    : ${messaging.providerLabel()}`);
  console.log(`  업로드 링크  : ${scheduler.uploadUrl(token)}`);
  console.log('\n다음 명령으로 1차 알림톡을 지금 발송합니다.');
  console.log('  node scripts/e2e-test.js send\n');
}

async function send() {
  const project = latestTestProject();
  if (!project) return console.error('\n테스트 주문이 없습니다. 먼저 setup 을 실행하세요.\n');
  if (messaging.provider() === 'mock') {
    console.log('\n※ 현재 mock 모드입니다. 실제 카카오톡은 발송되지 않고 기록만 남습니다.');
    console.log('   실제 발송하려면 STONEKIM_MSG_PROVIDER=solapi 와 API 키 설정이 필요합니다.\n');
  }
  const result = await scheduler.sendNow(project.project_id, 'FIRST');
  if (!result.ok) return console.error(`\n발송하지 못했습니다: ${result.error}\n`);
  const message = db
    .prepare("SELECT * FROM messages WHERE project_id = ? AND message_type='FIRST' ORDER BY message_id DESC LIMIT 1")
    .get(project.project_id);
  console.log(`\n발송 결과: ${STATUS_LABEL[message.status] || message.status} (${message.channel || '-'})`);
  if (message.failure_reason) console.log(`비고: ${message.failure_reason}`);
  console.log('\n휴대폰에서 카카오톡을 확인하고, 버튼을 눌러 사진 3장을 등록해 보세요.');
  console.log('등록 후 아래로 결과를 확인합니다.');
  console.log('  node scripts/e2e-test.js status\n');
}

function status() {
  const project = latestTestProject();
  if (!project) return console.error('\n테스트 주문이 없습니다. 먼저 setup 을 실행하세요.\n');

  const messages = db
    .prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY message_id')
    .all(project.project_id);
  const photoRows = photos.listPhotos(project.project_id);
  const reward = db.prepare('SELECT * FROM rewards WHERE project_id = ?').get(project.project_id);

  const firstSent = messages.some((m) => m.message_type === 'FIRST' && ['SENT', 'SENT_SMS'].includes(m.status));
  const opened = project.open_count > 0;
  const enoughPhotos = photoRows.length >= photos.limits().min;
  const canceled = messages.filter((m) => m.status === 'CANCELED_PHOTO');
  const stillScheduled = messages.filter((m) => m.status === 'SCHEDULED');
  const reviewed = photoRows.some((p) => p.review_status !== 'PENDING' || p.is_best);
  const rewardSet = !!reward && reward.status !== 'PENDING';

  console.log(`\n■ ${project.order_number} · ${formatPhone(project.phone)}`);
  console.log(`  업로드 링크 : ${scheduler.uploadUrl(project.upload_token)}`);
  console.log(`  현재 상태   : ${project.status} · 링크 열람 ${project.open_count}회`);

  console.log('\n■ 발송 이력');
  for (const m of messages) {
    const when = m.status === 'SCHEDULED' ? `예약 ${fmtDateTime(m.scheduled_at)}` : fmtDateTime(m.sent_at);
    console.log(`  ${TYPE_LABEL[m.message_type] || m.message_type}  ${STATUS_LABEL[m.status] || m.status}  ${when}  ${m.channel || ''} ${m.failure_reason || ''}`);
  }

  console.log('\n■ 사진');
  if (!photoRows.length) console.log('  아직 등록된 사진이 없습니다.');
  for (const p of photoRows) {
    console.log(`  #${p.photo_id} ${p.mime_type} ${Math.round((p.byte_size || 0) / 1024)}KB ${p.is_best ? '★BEST' : ''} ${p.review_status}`);
  }

  console.log('\n■ 리워드');
  console.log(reward ? `  ${reward.amount.toLocaleString('ko-KR')}원 · ${reward.status} ${reward.memo || ''}` : '  아직 없음');

  console.log('\n■ 체크리스트');
  console.log(`  ${mark(firstSent)} 1차 메시지 발송`);
  console.log(`  ${mark(opened)} 고객이 업로드 링크 열람`);
  console.log(`  ${mark(enoughPhotos)} 사진 ${photos.limits().min}장 이상 등록 (현재 ${photoRows.length}장)`);
  console.log(`  ${mark(project.status === 'PHOTO_SUBMITTED')} 주문 상태 PHOTO_SUBMITTED`);
  console.log(`  ${mark(canceled.length > 0 && stillScheduled.length === 0)} 예약된 2차/최종 메시지 자동취소 (취소 ${canceled.length}건 / 남은 예약 ${stillScheduled.length}건)`);
  console.log(`  ${mark(reviewed)} 관리자 사진 검수 (BEST/사용가능 지정)`);
  console.log(`  ${mark(rewardSet)} 리워드 금액·상태 설정`);

  const done = firstSent && enoughPhotos && project.status === 'PHOTO_SUBMITTED' && canceled.length > 0 && stillScheduled.length === 0;
  console.log(done ? '\n전체 흐름 정상 동작을 확인했습니다.\n' : '\n아직 남은 단계가 있습니다.\n');
}

function cleanup() {
  const project = latestTestProject();
  if (!project) return console.error('\n삭제할 테스트 주문이 없습니다.\n');
  for (const photo of photos.listPhotos(project.project_id)) photos.deletePhoto(photo.photo_id);
  db.prepare('DELETE FROM messages WHERE project_id = ?').run(project.project_id);
  db.prepare('DELETE FROM rewards WHERE project_id = ?').run(project.project_id);
  db.prepare('DELETE FROM page_visits WHERE project_id = ?').run(project.project_id);
  db.prepare('DELETE FROM projects WHERE project_id = ?').run(project.project_id);
  console.log(`\n테스트 주문 ${project.order_number} 삭제 완료.`);
  console.log(`발송 허용 번호는 그대로 유지됩니다: ${getSetting('send_allowlist') || '(없음)'}\n`);
}

function open() {
  setSetting('send_allowlist', '');
  audit({ user_id: null, username: 'e2e-script' }, 'ALLOWLIST_CLEARED', null, null, 'localhost');
  console.log('\n발송 허용 번호를 해제했습니다. 이제 등록된 모든 고객에게 예약대로 발송됩니다.');
  console.log('소규모 오픈이라면 설정 > 일일 발송 한도를 먼저 지정하세요.\n');
}

(async () => {
  if (command === 'setup') return setup(process.argv[3]);
  if (command === 'send') return send();
  if (command === 'status') return status();
  if (command === 'cleanup') return cleanup();
  if (command === 'open') return open();
  console.log('\n사용법: node scripts/e2e-test.js [setup <번호> | send | status | cleanup | open]\n');
})();
