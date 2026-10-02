'use strict';
const { getDb, getSetting } = require('./db');
const { readTable } = require('./xlsx');
const {
  normalizePhone, normalizeDate, randomToken, nowIso, toDateString, dateStringPlusDays,
} = require('./util');
const scheduler = require('./scheduler');

/** 헤더 → 내부 필드 매핑 (표기 흔들림 흡수) */
const HEADER_ALIASES = {
  // '일자-No.' 는 이카운트 판매조회의 기본 전표 열이다. 날짜가 함께 들어 있어 출고일도 여기서 뽑는다.
  order_number: ['주문번호', '주문 번호', '주문no', '주문 no', '오더번호', '수주번호', '전표번호', '문서번호', '판매번호', '판매No', '일자-No.', '일자No', '일자-번호', 'order_number', 'orderno'],
  ship_date: ['출고일', '출고일자', '출고날짜', '납품일', '납품일자', '출하일', '판매일자', '전표일자', '일자', 'ship_date', 'shipdate'],
  customer_name: ['고객명', '고객', '성명', '이름', '수취인', '수령인', '거래처명', '거래처', 'customer', 'name'],
  phone: ['휴대폰번호', '휴대폰', '핸드폰', '연락처', '전화번호', '휴대전화', '수신번호', '고객연락처', '거래처연락처', 'phone', 'mobile'],
  product: ['제품명', '제품', '품명', '품목명', '품목', '상품명', 'product'],
  quantity: ['수량', '개수', '수량(ea)', 'qty', 'quantity'],
  amount: ['금액', '금 액', '합계금액', '금액합계', '공급가액', '매출액', '판매금액', '합계', 'amount'],
  site_name: ['현장명', '현장', '납품현장', '납품처', '납품장소', 'site', 'site_name'],
  region: ['현장지역', '지역', '시공지역', '주소', '납품주소', 'region'],
  installation_date: ['시공예정일', '시공일', '시공예정', '설치예정일', '설치일', 'installation_date'],
  sales_manager: ['담당자', '영업담당', '담당', '영업사원', '담당자명', '사원(담당)명', '사원명', '담당사원', 'manager', 'sales_manager'],
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

/**
 * 헤더가 몇 번째 행인지 찾는다.
 * ERP 출력물은 첫 줄에 회사명·기간이 오고 그 아래에 헤더가 있는 경우가 많다.
 * 휴대폰번호처럼 필수 열이 빠져 있어도 헤더로 인정하고, 무엇이 없는지는 결과에 담아 알려준다.
 */
function findHeaderRow(rows) {
  let best = { index: -1, map: {}, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = mapHeaders(rows[i]);
    const score = Object.keys(map).length;
    const hasKey = map.order_number !== undefined || map.customer_name !== undefined;
    if (hasKey && score >= 2 && score > best.score) best = { index: i, map, score };
  }
  return best;
}

/**
 * 연락처 칸에서 휴대폰번호를 꺼낸다.
 * 이카운트 거래처 연락처에는 '조남 공장장님 010-8547-4975 /010-3278-4045' 처럼
 * 담당자 이름과 번호 여러 개가 한 칸에 들어 있는 경우가 많다. 첫 번째 번호를 쓰되,
 * 원문 그대로가 아니었다는 사실은 경고로 남겨 관리자가 눈으로 확인하게 한다.
 */
const PHONE_IN_TEXT = /(?<!\d)01[0-9][\s.\-]?\d{3,4}[\s.\-]?\d{4}(?!\d)/g;

function extractPhone(raw) {
  const direct = normalizePhone(raw);
  if (direct) return { phone: direct, extracted: false, others: [] };
  const found = [];
  for (const match of String(raw ?? '').matchAll(PHONE_IN_TEXT)) {
    const phone = normalizePhone(match[0]);
    if (phone && !found.includes(phone)) found.push(phone);
  }
  if (!found.length) return { phone: null, extracted: false, others: [] };
  return { phone: found[0], extracted: true, others: found.slice(1) };
}

/** '2026/10/14 -5' 처럼 전표번호 앞에 붙은 날짜를 꺼낸다 (출고일 열이 없는 ERP 출력 대응) */
function dateFromOrderNumber(orderNumber) {
  const match = String(orderNumber || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return null;
  return normalizeDate(`${match[1]}-${match[2]}-${match[3]}`);
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
      '헤더를 찾을 수 없습니다. 주문번호(판매번호) / 출고일 / 고객명(거래처) / 휴대폰번호 항목이 있어야 합니다.'
    );
  }
  const missingRequired = REQUIRED_FIELDS.filter((field) => map[field] === undefined);

  const existsStmt = checkExisting
    ? getDb().prepare('SELECT project_id FROM projects WHERE order_number = ?')
    : null;
  const seen = new Map();
  const rows = [];

  for (let i = headerIndex + 1; i < table.length; i++) {
    const raw = table[i];
    if (!raw) continue;
    const filled = raw.filter((cell) => String(cell ?? '').trim() !== '').length;
    // 빈 줄과 ERP 출력물 꼬리(출력일시 한 칸짜리 행)는 오류로 세지 않고 건너뛴다
    if (filled < 2) continue;

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
      amount_raw: pick('amount'),
    };
    // ERP 판매내역에서 취소·반품은 수량 또는 금액이 마이너스로 잡힌다.
    const negative = (value) => {
      const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
      const number = Number(cleaned);
      return Number.isFinite(number) && cleaned !== '' && number < 0;
    };
    record.canceled = negative(record.quantity) || negative(record.amount_raw);
    const phoneResult = extractPhone(record.phone_raw);
    record.phone = phoneResult.phone;
    record.ship_date = normalizeDate(pick('ship_date')) || dateFromOrderNumber(record.order_number);
    const installRaw = pick('installation_date');
    record.installation_date = installRaw ? normalizeDate(installRaw) : null;

    const errors = [];
    const warnings = [];
    if (record.canceled) {
      // 취소 전표는 등록 대상이 아니라 '발송 제외' 대상이다.
      record.errors = [{ code: 'CANCELED', text: '취소(마이너스) 전표 · 발송 제외 처리' }];
      record.warnings = [];
      record.valid = false;
      rows.push(record);
      continue;
    }
    if (!record.order_number) errors.push({ code: 'NO_ORDER', text: '주문번호 없음' });
    if (!record.customer_name) errors.push({ code: 'NO_NAME', text: '고객명 없음' });
    if (!record.phone) {
      errors.push({
        code: 'BAD_PHONE',
        text: map.phone === undefined ? '휴대폰번호 열 없음' : '전화번호 오류',
      });
    }
    if (!record.ship_date) errors.push({ code: 'BAD_SHIP_DATE', text: '출고일 오류' });
    if (installRaw && !record.installation_date) {
      warnings.push({ code: 'BAD_INSTALL_DATE', text: '시공예정일 형식 오류 (미입력 처리)' });
    }
    if (phoneResult.extracted) {
      warnings.push({
        code: 'PHONE_EXTRACTED',
        text: phoneResult.others.length
          ? `연락처에 번호가 ${phoneResult.others.length + 1}개 — 첫 번째 번호로 발송 (확인 필요)`
          : '연락처에서 번호만 추출 (확인 필요)',
      });
    }
    if (record.customer_name && normalizePhone(record.customer_name)) {
      warnings.push({ code: 'NAME_IS_PHONE', text: '고객명이 전화번호 — 메시지에 그대로 나갑니다' });
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
  return { rows, summary, headerMap: map, missingColumns, missingRequired, headerRow: headerIndex + 1 };
}

function summarize(rows) {
  const counts = { total: rows.length, valid: 0, bad_phone: 0, duplicate: 0, canceled: 0, other: 0, warning: 0 };
  for (const row of rows) {
    if (row.valid) counts.valid++;
    else if (row.canceled) counts.canceled++;
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
  const result = { created: 0, skipped: 0, scheduled: 0, deferred: 0, canceled: 0, canceled_by_phone: 0, cancel_unmatched: 0, errors: [] };
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
      // 취소 전표: 원래 주문을 찾아 자동 발송을 막는다.
      if (row.canceled) {
        const target = findCancelTarget(db, row);
        if (target) {
          const reason = target.how === 'order' ? 'ERP 취소 전표' : 'ERP 취소 전표 (번호 매칭)';
          db.prepare(
            'UPDATE projects SET message_excluded = 1, excluded_reason = ?, updated_at = ? WHERE project_id = ?'
          ).run(reason, nowIso(), target.project_id);
          scheduler.cancelScheduled(target.project_id, 'CANCELED_ADMIN', reason);
          result.canceled++;
          if (target.how === 'phone') result.canceled_by_phone++;
        } else {
          result.cancel_unmatched++;
        }
        continue;
      }
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

/**
 * 취소 전표가 어느 주문을 취소한 것인지 찾는다.
 * 이카운트는 취소를 새 전표로 끊기 때문에 '일자-No.' 가 원래 판매와 다르다.
 * 그래서 주문번호로 못 찾으면 같은 번호의 '아직 사진을 안 낸' 주문 중에서 찾는다.
 * 한 건으로 좁혀지지 않으면 손대지 않고 미매칭으로 보고한다 (엉뚱한 주문을 끄는 것보다 낫다).
 */
function findCancelTarget(db, row) {
  if (row.order_number) {
    const byOrder = db.prepare('SELECT project_id FROM projects WHERE order_number = ?').get(row.order_number);
    if (byOrder) return { project_id: byOrder.project_id, how: 'order' };
  }
  if (!row.phone) return null;
  const candidates = db
    .prepare(
      `SELECT p.project_id, p.product FROM projects p
         JOIN customers c ON c.customer_id = p.customer_id
        WHERE c.phone = ? AND p.photo_submitted_at IS NULL AND p.message_excluded = 0
        ORDER BY p.ship_date DESC, p.project_id DESC`
    )
    .all(row.phone);
  if (!candidates.length) return null;
  if (row.product) {
    const sameProduct = candidates.filter((c) => (c.product || '') === row.product);
    if (sameProduct.length === 1) return { project_id: sameProduct[0].project_id, how: 'phone' };
    if (sameProduct.length > 1) return null;
  }
  if (candidates.length === 1) return { project_id: candidates[0].project_id, how: 'phone' };
  return null;
}


/**
 * 주문 한 건을 손으로 등록한다 (전화 주문 · 이카운트에 아직 안 잡힌 건).
 * 엑셀 업로드와 같은 규칙을 쓰되, 주문번호를 비우면 자동으로 만들어 준다.
 * @returns {{ok:boolean, error?:string, project_id?:number, scheduled_at?:string}}
 */
function createManualProject(input, options = {}) {
  const db = getDb();
  const name = String(input.customer_name || '').trim();
  const phone = normalizePhone(input.phone);
  const shipDate = normalizeDate(input.ship_date) || toDateString(new Date());
  const installDate = input.installation_date ? normalizeDate(input.installation_date) : null;

  if (!name) return { ok: false, error: '고객명을 입력해 주세요.' };
  if (!phone) return { ok: false, error: '휴대폰번호 형식이 올바르지 않습니다.' };
  if (input.installation_date && !installDate) {
    return { ok: false, error: '시공예정일 형식이 올바르지 않습니다. (예: 2026-10-15)' };
  }

  // 주문번호를 안 적으면 날짜 기준으로 만들어 준다 (M20261002-1 …)
  let orderNumber = String(input.order_number || '').trim();
  if (!orderNumber) {
    const prefix = `M${shipDate.replace(/-/g, '')}`;
    const used = db
      .prepare("SELECT COUNT(*) AS c FROM projects WHERE order_number LIKE ?")
      .get(`${prefix}-%`).c;
    orderNumber = `${prefix}-${used + 1}`;
  }
  if (db.prepare('SELECT 1 AS x FROM projects WHERE order_number = ?').get(orderNumber)) {
    return { ok: false, error: `이미 등록된 주문번호입니다. (${orderNumber})` };
  }

  const customerId = findOrCreateCustomer(name, phone);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects
      (order_number, customer_id, product, quantity, ship_date, installation_date,
       site_name, region, sales_manager, upload_token, status, message_excluded,
       excluded_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'READY', ?, ?, ?, ?)`
  ).run(
    orderNumber, customerId,
    String(input.product || '').trim() || null,
    String(input.quantity || '').trim() || null,
    shipDate, installDate,
    String(input.site_name || '').trim() || null,
    String(input.region || '').trim() || null,
    String(input.sales_manager || '').trim() || null,
    randomToken(),
    options.hold ? 1 : 0,
    options.hold ? '수기 등록 시 발송 보류' : null,
    ts, ts
  );
  const projectId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

  let scheduledAt = null;
  if (!options.hold) {
    const messageId = scheduler.scheduleFirstMessage(projectId);
    if (messageId) {
      const message = db.prepare('SELECT scheduled_at FROM messages WHERE message_id = ?').get(messageId);
      const clamped = clampSchedule(message.scheduled_at, new Date());
      if (clamped !== message.scheduled_at) {
        db.prepare('UPDATE messages SET scheduled_at = ? WHERE message_id = ?').run(clamped, messageId);
      }
      scheduledAt = clamped;
    }
  }
  return { ok: true, project_id: projectId, order_number: orderNumber, scheduled_at: scheduledAt };
}

function discardBatch(batchId) {
  getDb().prepare("UPDATE import_batches SET status = 'DISCARDED' WHERE batch_id = ? AND status = 'PREVIEW'")
    .run(batchId);
}

module.exports = {
  extractPhone,
  createManualProject,
  HEADER_ALIASES,
  dateFromOrderNumber,
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
