'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useTempData } = require('./helper');
useTempData('import');

const { getDb } = require('../src/db');
const importer = require('../src/import');
const xlsx = require('../src/xlsx');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample_shipment.xlsx');

test('xlsx 파일을 의존성 없이 읽는다', () => {
  const rows = xlsx.readTable(fs.readFileSync(FIXTURE), 'sample_shipment.xlsx');
  assert.equal(rows[0][0], '주문번호');
  assert.equal(rows[1][2], '김민수');
  assert.equal(rows.length, 7);
});

test('CSV 도 읽는다 (따옴표·쉼표 포함)', () => {
  const rows = xlsx.readCsv('a,b\n"김,민수",010-1234-5678\n');
  assert.deepEqual(rows[1], ['김,민수', '010-1234-5678']);
});

test('업로드 미리보기: 정상/전화번호 오류/중복을 구분한다', () => {
  const result = importer.parseUpload(fs.readFileSync(FIXTURE), 'sample_shipment.xlsx');
  assert.equal(result.summary.total, 6);
  assert.equal(result.summary.valid, 3, 'SK001·SK002·SK003 만 정상');
  assert.equal(result.summary.duplicate, 1, '파일 내 중복 SK001');
  assert.equal(result.summary.bad_phone, 1, '유선번호 SK004');
  assert.equal(result.summary.other, 1, '주문번호 없는 행');

  const sk001 = result.rows.find((r) => r.order_number === 'SK001');
  assert.equal(sk001.phone, '01012345678');
  assert.equal(sk001.ship_date, '2026-09-22');
  assert.equal(sk001.installation_date, '2026-09-28');

  const sk002 = result.rows.find((r) => r.order_number === 'SK002');
  assert.equal(sk002.phone, '01098765432', '앞자리 0 이 사라진 번호도 복구');
  assert.equal(sk002.installation_date, null, '시공예정일 미입력 허용');
});

test('등록 시 정상 건만 저장되고 1차 메시지가 예약된다', () => {
  const db = getDb();
  const parsed = importer.parseUpload(fs.readFileSync(FIXTURE), 'sample_shipment.xlsx');
  const batchId = importer.saveBatch({ fileName: 'a.xlsx', rows: parsed.rows, summary: parsed.summary, username: 'admin' });
  const result = importer.commitBatch(batchId);

  assert.equal(result.ok, true);
  assert.equal(result.created, 3);
  assert.equal(result.scheduled, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM projects').get().c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE status='SCHEDULED'").get().c, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM customers').get().c, 3);

  // 고유 업로드 토큰이 주문마다 다르게 부여된다
  const tokens = db.prepare('SELECT upload_token FROM projects').all().map((r) => r.upload_token);
  assert.equal(new Set(tokens).size, 3);
  for (const token of tokens) assert.ok(token.length >= 32);
});

test('같은 파일을 다시 올리면 중복 주문으로 걸러진다', () => {
  const parsed = importer.parseUpload(fs.readFileSync(FIXTURE), 'sample_shipment.xlsx');
  assert.equal(parsed.summary.valid, 0, '이미 등록된 주문은 모두 중복 처리');
  assert.equal(parsed.summary.duplicate, 4);
});

test('이미 등록된 배치는 다시 커밋되지 않는다', () => {
  const batch = getDb().prepare("SELECT batch_id FROM import_batches WHERE status='COMMITTED'").get();
  const again = importer.commitBatch(batch.batch_id);
  assert.equal(again.ok, false);
});

test('취소(마이너스) 전표는 등록하지 않고, 기존 주문의 자동 발송을 중단한다', () => {
  const db = getDb();
  const { getDb: _ } = require('../src/db');

  // 정상 1건 등록
  const normal =
    '주문번호,출고일,고객명,휴대폰번호,제품명,수량\n' +
    'SK7001,2026-09-10,정상고객,010-3333-1111,칼라카타,3\n';
  const first = importer.parseUpload(Buffer.from(normal, 'utf8'), 'a.csv');
  const batch1 = importer.saveBatch({ fileName: 'a.csv', rows: first.rows, summary: first.summary });
  importer.commitBatch(batch1);
  const project = db.prepare("SELECT * FROM projects WHERE order_number = 'SK7001'").get();
  assert.equal(project.message_excluded, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND status='SCHEDULED'").get(project.project_id).c, 1);

  // 같은 주문번호의 취소 전표 + 원 주문이 없는 취소 전표
  const canceled =
    '주문번호,출고일,고객명,휴대폰번호,제품명,수량\n' +
    'SK7001,2026-09-12,정상고객,010-3333-1111,칼라카타,-3\n' +
    'SK7009,2026-09-12,모르는고객,010-3333-2222,비앙코,-1\n';
  const second = importer.parseUpload(Buffer.from(canceled, 'utf8'), 'b.csv');
  assert.equal(second.summary.canceled, 2, '취소 건은 따로 집계된다');
  assert.equal(second.summary.valid, 0, '취소 건은 등록 대상이 아니다');

  const batch2 = importer.saveBatch({ fileName: 'b.csv', rows: second.rows, summary: second.summary });
  const result = importer.commitBatch(batch2);
  assert.equal(result.canceled, 1, '원 주문을 찾은 취소 건만 처리된다');
  assert.equal(result.cancel_unmatched, 1);
  assert.equal(result.created, 0, '취소 전표로 새 주문이 생기지 않는다');

  const after = db.prepare("SELECT * FROM projects WHERE order_number = 'SK7001'").get();
  assert.equal(after.message_excluded, 1, '자동 발송 제외로 전환');
  assert.equal(after.excluded_reason, 'ERP 취소 전표');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE project_id = ? AND status='SCHEDULED'").get(project.project_id).c, 0, '예약 메시지가 중단된다');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM projects WHERE order_number = 'SK7009'").get().c, 0);
});

test('예약 시각이 지난 건은 다음 발송창으로 미뤄 즉시 대량발송을 막는다', () => {
  const now = new Date('2026-09-21T12:00:00+09:00');
  const past = '2026-09-01T01:00:00.000Z';
  const clamped = importer.clampSchedule(past, now);
  assert.ok(new Date(clamped).getTime() > now.getTime(), '과거 예약은 미래로 조정');

  const future = '2026-10-01T01:00:00.000Z';
  assert.equal(importer.clampSchedule(future, now), future, '미래 예약은 그대로');
});

test('이카운트 판매조회 출력물을 그대로 읽는다', () => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'ecount_sales.xlsx'));
  const result = importer.parseUpload(buffer, 'ecount_sales.xlsx', { checkExisting: false });

  assert.equal(result.headerRow, 2, '첫 줄 회사명 아래의 헤더를 찾는다');
  assert.equal(result.summary.total, 3, '출력일시 꼬리 행은 건수에 포함하지 않는다');
  assert.deepEqual(result.missingRequired, ['ship_date', 'phone']);

  const [first] = result.rows;
  assert.equal(first.order_number, '2026/09/28 -53');
  assert.equal(first.ship_date, '2026-09-28', '판매번호 앞의 날짜를 출고일로 쓴다');
  assert.equal(first.customer_name, '주식회사 가나건설');
  assert.equal(first.sales_manager, '유송희');
  assert.match(first.product, /S-K035/);

  // 금액이 마이너스인 반품 건은 취소로 분류된다
  assert.equal(result.summary.canceled, 1);
  const canceledRow = result.rows.find((row) => row.canceled);
  assert.equal(canceledRow.order_number, '2026/09/26 -7');

  // 휴대폰번호 열이 없으면 이유를 명확히 알려준다
  assert.ok(result.rows.every((row) => !row.valid));
  assert.match(first.errors.find((e) => e.code === 'BAD_PHONE').text, /열 없음/);
});

test('주문번호에서 날짜를 꺼낸다', () => {
  assert.equal(importer.dateFromOrderNumber('2026/10/14 -5'), '2026-10-14');
  assert.equal(importer.dateFromOrderNumber('SK1001'), null);
});

test('ERP 에서 내려받은 표기도 인식한다 (이카운트 등)', () => {
  const map = importer.mapHeaders(['전표번호', '일자', '거래처명', '휴대폰번호', '품목명', '수량', '납품처', '담당자']);
  assert.equal(map.order_number, 0);
  assert.equal(map.ship_date, 1);
  assert.equal(map.customer_name, 2);
  assert.equal(map.phone, 3);
  assert.equal(map.product, 4);
  assert.equal(map.site_name, 6);
  assert.equal(map.sales_manager, 7);
});

test('헤더 표기가 달라도 매핑된다', () => {
  const map = importer.mapHeaders(['주문 번호', '출고일자', '성명', '연락처', '품명', '시공일']);
  assert.equal(map.order_number, 0);
  assert.equal(map.ship_date, 1);
  assert.equal(map.customer_name, 2);
  assert.equal(map.phone, 3);
  assert.equal(map.product, 4);
  assert.equal(map.installation_date, 5);
});
