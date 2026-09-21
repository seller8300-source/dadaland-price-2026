'use strict';
const { getDb, getSetting } = require('./db');
const { readTable } = require('./xlsx');
const {
  normalizePhone, normalizeDate, randomToken, nowIso, toDateString, dateStringPlusDays,
} = require('./util');
const scheduler = require('./scheduler');

/** 헤더 → 내부 필드 매핑 (표기 흔들림 흡수) */
const HEADER_ALIASES = {
  order_number: ['주문번호', '주문 번호', '주문no', '주문 no', '오더번호', '수주번호', '전표번호', 'order_number', 'orderno'],
  ship_date: ['출고일', '출고일자', '출고날짜', '납품일', '출하일', 'ship_date', 'shipdate'],
  customer_name: ['고객명', '고객', '성명', '이름', '수취인', '거래처명', 'customer', 'name'],
  phone: ['휴대폰번호', '휴대폰', '핸드폰', '연락처', '전화번호', '휴대전화', 'phone', 'mobile'],
  product: ['제품명', '제품', '품명', '상품명', 'product'],
  quantity: ['수량', '개수', '수량(ea)', 'qty', 'quantity'],
  site_name: ['현장명', '현장', '납품현장', 'site', 'site_name'],
  region: ['현장지역', '지역', '시공지역', '주소', 'region'],
  installation_date: ['시공예정일', '시공일', '시공예정', '설치예정일', '설치일', 'installation_date'],
  sales_manager: ['담당자', '영업담당', '담당', '영업사원', 'manager', 'sales_manager'],
};

const REQUIRED_FIELDS = ['order_number', 'ship_date', 'customer_name', 'phone'];

function normalizeHeader(value) {
  return String(value || '').replace(/\s|\(|\)|_|-|\./g, '').toLowerCase();
}

/** 헤더 행에서 필드 → 열 인덱스 매핑을 만든다. */
function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some((alias) => normalizeHeader(alias) === key)) map[field] = index;
    }
  });
  return map;
}

/** 헤더가 몇 번째 행인지 찾는다 (제목 행이 위에 있는 파일 대응) */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map = mapHeaders(rows[i]);
    if (map.order_number !== undefined && map.phone !== undefined) return { index: i, map };
  }
  return { index: -1, map: {} };
}

/**
 * 업로드된 파일을 검증해 미리보기 결과를 만든다.
 * @param {Buffer} buffer 업로드 파일
 * @param {string} fileName 원본 파일명(형식 판별용)
 * @param {{checkExisting?: boolean}} options checkExisting=false 면 DB 를 건드리지 않는다(진단 스크립트용)
 * @returns {{rows: Array, summary: Object, headerMap: Object, missingColumns: string[]}}
 */
function parseUpload(buffer, fileName, options = {}) {
  const checkExisting = options.checkExisting !== false;
  const table = readTable(buffer, fileName);
  const { index: headerIndex, map } = findHeaderRow(table);
  if (headerIndex < 0) {
    throw new Error(
      '헤더를 찾을 수 없습니다. 첫 행에 주문번호 / 출고일 / 고객명 / 휴대폰번호 항목이 있어야 합니다.'
    );
  }

  const existsStmt = checkExisting
    ? getDb().prepare('SELECT project_id FROM projects WHERE order_number = ?')
    : null;
  const seen = new Map();
  const rows = [];

  for (let i = headerIndex + 1; i < table.length; i++) {
    const raw = table[i];
    if (!raw || raw.every((cell) => String(cell ?? '').trim() === '')) continue;

    const pick = (field) => (map[field] === undefined ? '' : String(raw[map[field]] ?? '').trim());
    const record = {
      line: i + 1,
      order_number: pick('order_number'),
      customer_name: pick('customer_name'),
      phone_raw: pick('phone'),
      product: pick('product'),
      quantity: pick('quantity'),
      site_name: pick('site_name'),
      region: pick('region'),
      sales_manager: pick('sales_manager'),
    };
    record.phone = normalizePhone(record.phone_raw);
    record.ship_date = normalizeDate(pick('ship_date'));
    const installRaw = pick('installation_date');
    record.installation_date = installRaw ? normalizeDate(installRaw) : null;

    const errors = [];
    const warnings = [];
    if (!record.order_number) errors.push({ code: 'NO_ORDER', text: '주문번호 없음' });
    if (!record.customer_name) errors.push({ code: 'NO_NAME', text: '고객명 없음' });
    if (!record.phone) errors.push({ code: 'BAD_PHONE', text: '전화번호 오류' });
    if (!record.ship_date) errors.push({ code: 'BAD_SHIP_DATE', text: '출고일 오류' });
    if (installRaw && !record.installation_date) {
      warnings.push({ code: 'BAD_INSTALL_DATE', text: '시공예정일 형식 오류 (미입력 처리)' });
    }
    if (record.order_number) {
      if (seen.has(record.order_number)) {
        errors.push({ code: 'DUP_FILE', text: `파일 내 중복 (${seen.get(record.order_number)}행)` });
      } else if (existsStmt && existsStmt.get(record.order_number)) {
        errors.push({ code: 'DUP_DB', text: '이미 등록된 주문번호' });
      } else {
        seen.set(record.order_number, record.line);
      }
    }

    record.errors = errors;
    record.warnings = warnings;
    record.valid = errors.length === 0;
    rows.push(record);
  }

  const summary = summarize(rows);
  const missingColumns = Object.keys(HEADER_ALIASES).filter((field) => map[field] === undefined);
  return { rows, summary, headerMap: map, missingColumns };
}

function summarize(rows) {
  const counts = { total: rows.length, valid: 0, bad_phone: 0, duplicate: 0, other: 0, warning: 0 };
  for (const row of rows) {
    if (row.valid) counts.valid++;
    else if (row.errors.some((e) => e.code === 'BAD_PHONE')) counts.bad_phone++;
    else if (row.errors.some((e) => e.code === 'DUP_FILE' || e.code === 'DUP_DB')) counts.duplicate++;
    else counts.other++;
    if (row.warnings.length) counts.warning++;
  }
  counts.invalid = counts.total - counts.valid;
  return counts;
}

function saveBatch({ fileName, rows, summary, username }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO import_batches (file_name, total_rows, valid_rows, payload, status, created_by, created_at)
     VALUES (?, ?, ?, ?, 'PREVIEW', ?, ?)`
  ).run(fileName || '', summary.total, summary.valid, JSON.stringify(rows), username || null, nowIso());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function getBatch(batchId) {
  const row = getDb().prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(batchId);
  if (!row) return null;
  return { ...row, rows: JSON.parse(row.payload) };
}

function findOrCreateCustomer(name, phone) {
  const db = getDb();
  const found = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (found) {
    if (name && name !== found.name) {
      db.prepare('UPDATE customers SET name = ? WHERE customer_id = ?').run(name, found.customer_id);
    }
    return found.customer_id;
  }
  db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)').run(name, phone, nowIso());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

/**
 * 예약시각이 이미 지난 경우 즉시 대량발송이 일어나지 않도록 다음 발송창으로 미룬다.
 * (§20 대량발송 실수 방지)
 */
function clampSchedule(scheduledAt, now = new Date()) {
  if (!scheduledAt) return null;
  if (new Date(scheduledAt).getTime() > now.getTime()) return scheduledAt;
  const hour = scheduler.sendHour();
  const today = toDateString(now);
  const todayWindow = dateStringPlusDays(today, 0, hour);
  // 오늘 발송창이 아직 4시간 이상 남았으면 오늘, 아니면 내일
  if (new Date(todayWindow).getTime() - now.getTime() > 4 * 3600 * 1000) return todayWindow;
  return dateStringPlusDays(today, 1, hour);
}

/**
 * 미리보기 배치에서 정상 건만 등록하고 1차 메시지를 예약한다.
 * @param {number} batchId
 * @param {{hold?: boolean}} options hold=true 이면 등록만 하고 자동발송에서 제외한다.
 */
function commitBatch(batchId, options = {}) {
  const db = getDb();
  const batch = getBatch(batchId);
  if (!batch) return { ok: false, error: '업로드 내역을 찾을 수 없습니다.' };
  if (batch.status === 'COMMITTED') return { ok: false, error: '이미 등록된 업로드입니다.' };

  const now = new Date();
  const result = { created: 0, skipped: 0, scheduled: 0, deferred: 0, errors: [] };
  const insertProject = db.prepare(
    `INSERT INTO projects
      (order_number, customer_id, product, quantity, ship_date, installation_date,
       site_name, region, sales_manager, upload_token, status, message_excluded,
       excluded_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'READY', ?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    for (const row of batch.rows) {
      if (!row.valid) { result.skipped++; continue; }
      if (db.prepare('SELECT 1 AS x FROM projects WHERE order_number = ?').get(row.order_number)) {
        result.skipped++;
        continue;
      }
      const customerId = findOrCreateCustomer(row.customer_name, row.phone);
      const ts = nowIso();
      insertProject.run(
        row.order_number, customerId, row.product || null, row.quantity || null,
        row.ship_date, row.installation_date || null, row.site_name || null,
        row.region || null, row.sales_manager || null, randomToken(),
        options.hold ? 1 : 0, options.hold ? '업로드 시 발송 보류' : null, ts, ts
      );
      const projectId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      result.created++;

      if (!options.hold) {
        const messageId = scheduler.scheduleFirstMessage(projectId);
        if (messageId) {
          const message = db.prepare('SELECT scheduled_at FROM messages WHERE message_id = ?').get(messageId);
          const clamped = clampSchedule(message.scheduled_at, now);
          if (clamped !== message.scheduled_at) {
            db.prepare('UPDATE messages SET scheduled_at = ? WHERE message_id = ?').run(clamped, messageId);
            result.deferred++;
          }
          result.scheduled++;
        }
      }
    }
    db.prepare("UPDATE import_batches SET status = 'COMMITTED', committed_at = ? WHERE batch_id = ?")
      .run(nowIso(), batchId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { ok: false, error: err.message };
  }
  return { ok: true, ...result };
}

function discardBatch(batchId) {
  getDb().prepare("UPDATE import_batches SET status = 'DISCARDED' WHERE batch_id = ? AND status = 'PREVIEW'")
    .run(batchId);
}

module.exports = {
  HEADER_ALIASES,
  REQUIRED_FIELDS,
  mapHeaders,
  findHeaderRow,
  parseUpload,
  summarize,
  saveBatch,
  getBatch,
  commitBatch,
  discardBatch,
  clampSchedule,
  findOrCreateCustomer,
};
