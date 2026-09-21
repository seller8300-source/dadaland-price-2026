'use strict';
/**
 * 데모 데이터 생성 스크립트.
 *   node scripts/seed.js
 * 개발·시연용이며 운영 DB 에는 실행하지 않는다.
 */
const { getDb } = require('../src/db');
const auth = require('../src/auth');
const scheduler = require('../src/scheduler');
const { randomToken, nowIso, toDateString, dateStringPlusDays } = require('../src/util');

const db = getDb();
const today = new Date();
const day = (offset) => toDateString(new Date(today.getTime() + offset * 86400000));

if (!auth.countUsers()) auth.createUser('admin', 'stonekim1234', '관리자');

const SAMPLES = [
  { order: 'SK1001', name: '김민수', phone: '01012345678', product: '칼라카타 600×2400', qty: '12EA', ship: day(-20), install: day(-16), site: '래미안 101동', region: '서울 강남', manager: '박영업' },
  { order: 'SK1002', name: '이서연', phone: '01098765432', product: '비앙코 1200×2400', qty: '6EA', ship: day(-18), install: null, site: '자이 202호', region: '경기 성남', manager: '박영업' },
  { order: 'SK1003', name: '최도윤', phone: '01055550000', product: '그레이 800×800', qty: '20EA', ship: day(-12), install: day(-8), site: '한샘 매장', region: '부산 해운대', manager: '정담당' },
  { order: 'SK1004', name: '한지우', phone: '01077778888', product: '슬랩 자재', qty: '3EA', ship: day(-3), install: day(4), site: '사옥 로비', region: '대구 수성', manager: '정담당' },
  { order: 'SK1005', name: '박서준', phone: '01033334444', product: '칼라카타 600×1200', qty: '9EA', ship: day(-1), install: null, site: '신축 빌라', region: '인천 연수', manager: '박영업' },
];

for (const s of SAMPLES) {
  if (db.prepare('SELECT 1 AS x FROM projects WHERE order_number = ?').get(s.order)) continue;
  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(s.phone);
  if (!customer) {
    db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)').run(s.name, s.phone, nowIso());
    customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(s.phone);
  }
  db.prepare(
    `INSERT INTO projects (order_number, customer_id, product, quantity, ship_date, installation_date,
       site_name, region, sales_manager, upload_token, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'READY', ?, ?)`
  ).run(s.order, customer.customer_id, s.product, s.qty, s.ship, s.install, s.site, s.region, s.manager,
    randomToken(), nowIso(), nowIso());
  const projectId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  scheduler.scheduleFirstMessage(projectId);
  console.log(`등록: ${s.order} · ${s.name} · ${scheduler.uploadUrl(
    db.prepare('SELECT upload_token FROM projects WHERE project_id = ?').get(projectId).upload_token
  )}`);
}

console.log('\n데모 데이터 준비 완료. 관리자 계정이 없었다면 admin / stonekim1234 로 로그인하세요.');
