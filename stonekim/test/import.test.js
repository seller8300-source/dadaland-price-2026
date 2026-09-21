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

test('예약 시각이 지난 건은 다음 발송창으로 미뤄 즉시 대량발송을 막는다', () => {
  const now = new Date('2026-09-21T12:00:00+09:00');
  const past = '2026-09-01T01:00:00.000Z';
  const clamped = importer.clampSchedule(past, now);
  assert.ok(new Date(clamped).getTime() > now.getTime(), '과거 예약은 미래로 조정');

  const future = '2026-10-01T01:00:00.000Z';
  assert.equal(importer.clampSchedule(future, now), future, '미래 예약은 그대로');
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
