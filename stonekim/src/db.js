'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.STONEKIM_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.STONEKIM_DB || path.join(DATA_DIR, 'stonekim.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number      TEXT NOT NULL UNIQUE,
  customer_id       INTEGER NOT NULL REFERENCES customers(customer_id),
  product           TEXT,
  quantity          TEXT,
  ship_date         TEXT NOT NULL,           -- YYYY-MM-DD
  installation_date TEXT,                    -- YYYY-MM-DD, 모를 경우 NULL
  site_name         TEXT,
  region            TEXT,
  sales_manager     TEXT,
  upload_token      TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'READY',
  message_excluded  INTEGER NOT NULL DEFAULT 0,
  excluded_reason   TEXT,
  contractor        TEXT,                    -- 고객이 입력한 시공업체명 (필수 입력)
  venue_name        TEXT,                    -- 업장명·상호 (카페, 매장 등)
  reward_phone      TEXT,                    -- 상품권 받을 번호 (발송 번호와 다를 수 있다)
  show_name_consent INTEGER NOT NULL DEFAULT 0, -- 업체명·업장명 노출 희망
  sns               TEXT,
  review_text       TEXT,
  consent_at        TEXT,                    -- 사진 활용 동의 시각
  consent_text      TEXT,                    -- 동의 당시 문구 스냅샷
  photo_submitted_at TEXT,
  first_opened_at   TEXT,
  open_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_ship ON projects(ship_date);

CREATE TABLE IF NOT EXISTS messages (
  message_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER REFERENCES projects(project_id) ON DELETE CASCADE, -- 테스트 발송은 NULL
  message_type   TEXT NOT NULL,              -- FIRST | SECOND | FINAL | TEST | MANUAL
  to_phone       TEXT,
  scheduled_at   TEXT,
  sent_at        TEXT,
  channel        TEXT,                       -- ALIMTALK | SMS | LMS
  status         TEXT NOT NULL,              -- SCHEDULED | SENT | FAILED | SENT_SMS | CANCELED_PHOTO | CANCELED_ADMIN
  failure_reason TEXT,
  body           TEXT,
  provider_ref   TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_due ON messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);

CREATE TABLE IF NOT EXISTS photos (
  photo_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  mime_type     TEXT,
  byte_size     INTEGER,
  needs_convert INTEGER NOT NULL DEFAULT 0,  -- HEIC 등 원본 그대로 저장된 경우
  uploaded_by   TEXT NOT NULL DEFAULT 'CUSTOMER', -- CUSTOMER | ADMIN
  created_at    TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | USABLE | UNUSABLE
  is_best       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);

CREATE TABLE IF NOT EXISTS rewards (
  reward_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(project_id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SCHEDULED | PAID | EXCLUDED
  paid_at    TEXT,
  memo       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'STAFF',   -- OWNER = 설정·계정까지, STAFF = 일상 업무만
  active        INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  batch_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT,
  total_rows  INTEGER NOT NULL DEFAULT 0,
  valid_rows  INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL,                 -- JSON: 파싱 결과 (미리보기)
  status      TEXT NOT NULL DEFAULT 'PREVIEW', -- PREVIEW | COMMITTED | DISCARDED
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS page_visits (
  visit_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL,
  user_agent TEXT
);
`;

const DEFAULT_SETTINGS = {
  consent_text:
    '제출한 사진을 스톤킴의 홈페이지, SNS, 블로그, 카탈로그 및 광고·홍보 콘텐츠에 활용하는 것에 동의합니다.',
  privacy_text:
    '리워드 지급 및 사진 활용 안내를 위해 주문정보(성함·연락처)를 이용하며, 목적 달성 후 파기합니다. 자세한 내용은 스톤킴 개인정보처리방침을 따릅니다.',
  // 고객 화면·문자 대체발송에 쓰이는 리워드 안내. 승인된 알림톡 내용과 맞춘다.
  reward_headline: '사진만 등록하셔도\n신세계상품권 3만원을 드려요 🎁',
  reward_benefits:
    '💳 등록 고객 100% 신세계상품권 3만원\n' +
    '🏆 매월 BEST 선정 시 10만원 추가 지급\n' +
    '📢 우수 시공사례는 스톤킴 공식 채널 게시',
  // 사진 등록을 마친 화면에 띄우는 안내. 여기서는 금액을 다시 강조하지 않고
  // 언제 어떻게 받는지만 알려준다 (이미 등록을 끝낸 고객이라 혜택 홍보가 필요 없다).
  done_notice:
    '백화점 상품권은 남겨주신 연락처로 영업일 기준 5~14일 이내 순차 발송해 드립니다.\n' +
    '베스트 시공 사례로 선정되시면 담당자가 따로 연락드리겠습니다.',
  reward_criteria_text:
    '완공된 현장이 잘 보이는 사진 3장 이상을 등록해주세요. ' +
    '확인 후 등록하신 연락처로 지급 안내를 드립니다.',
  // 고객 화면 상단에 표시할 로고 이미지 주소 (비우면 STONE KIM 글자 로고)
  brand_logo_url: '',
  daily_send_limit: '0',
  // 비어 있으면 제한 없음. 번호가 하나라도 있으면 그 번호에만 발송된다(실전 테스트용 안전장치).
  send_allowlist: '',
  // 알림톡 심사 통과를 위해 기본값은 정보성 문구.
  // 혜택 문구가 승인되면 관리자 설정에서 reward 로 바꾼다.
  message_variant: 'info',
  test_phone: '',
  min_photos: '3',
  max_photos: '10',
  send_hour_kst: '10',
  // 자동 발송 단계 수: 1=1차만, 2=1·2차, 3=1·2·최종
  // 승인된 알림톡 템플릿이 2개뿐이면 2로 두면 된다.
  send_stages: '3',
  // 대리점·파트너처럼 아예 보내면 안 되는 곳. 한 줄에 하나씩, 번호 또는 거래처명 일부.
  // 등록 시점에 걸러 자동 발송 제외로 넣는다.
  exclude_list: '',
  // 같은 번호로 이 기간 안에 이미 보냈으면 다시 보내지 않는다 (0 이면 중복 발송 허용).
  dedupe_days: '30',
  // 시방서(시공 방법 안내). 출고 예정일이 아직 안 지난 주문에만 등록 즉시 보낸다.
  spec_enabled: '0',
  spec_link: '',
  // 한 줄에 하나씩 `품목코드=제품군`. 고객에게는 시방서 페이지의 어느 탭인지만 알려준다.
  spec_groups: 'SF=소프트스톤',
};

/**
 * 예전 기본 문구를 그대로 쓰고 있던 설정만 현재 기본값으로 올려준다.
 * 관리자가 직접 고친 문구는 건드리지 않는다.
 */
const LEGACY_DEFAULTS = {
  reward_headline: [
    '사진 등록만 하셔도 신세계상품권 3만원',
    '사진 등록만 하셔도 신세계상품권 3만원 🎁',
  ],
  reward_benefits: [
    '등록 고객 100% 신세계상품권 3만원\n매월 BEST 선정 시 10만원 추가 지급\n우수 시공사례는 스톤킴 공식 채널 게시',
  ],
  reward_criteria_text: [
    '등록해주신 사진을 확인한 뒤 리워드 대상 여부와 금액을 개별 안내드립니다. 완공된 현장 전체가 잘 보이는 사진일수록 시공사례로 선정될 가능성이 높습니다.',
    '사진 3장 이상을 등록해주시면 확인 후 기본 리워드를 드립니다. 완공된 현장이 잘 보이는 사진은 시공사례로 선정되어 추가 리워드를 드립니다. 지급까지는 영업일 기준 7일 정도 걸립니다.',
  ],
};

function upgradeLegacySettings(db) {
  const now = new Date().toISOString();
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?');
  for (const [key, oldValues] of Object.entries(LEGACY_DEFAULTS)) {
    const row = read.get(key);
    if (row && oldValues.includes(row.value) && DEFAULT_SETTINGS[key] !== row.value) {
      write.run(DEFAULT_SETTINGS[key], now, key);
    }
  }
}

let dbInstance = null;


/** 이미 만들어진 DB 에 나중에 생긴 열을 더한다 (SQLite 는 IF NOT EXISTS 를 지원하지 않는다) */
function addColumnIfMissing(db, table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function migrate(db) {
  addColumnIfMissing(db, 'projects', 'venue_name', 'TEXT');
  addColumnIfMissing(db, 'projects', 'reward_phone', 'TEXT');
  addColumnIfMissing(db, 'projects', 'show_name_consent', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'admin_users', 'role', "TEXT NOT NULL DEFAULT 'STAFF'");
  addColumnIfMissing(db, 'admin_users', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'admin_users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'admin_users', 'last_login_at', 'TEXT');
  // 역할이 생기기 전에 만들어진 DB 는 최초 계정(대표님)이 STAFF 로 남아 설정에 못 들어간다.
  const hasOwner = db.prepare("SELECT 1 AS x FROM admin_users WHERE role = 'OWNER'").get();
  if (!hasOwner) {
    db.exec("UPDATE admin_users SET role = 'OWNER' WHERE user_id = (SELECT MIN(user_id) FROM admin_users)");
  }
}

function getDb() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  seedSettings(db);
  upgradeLegacySettings(db);
  dbInstance = db;
  return db;
}

function seedSettings(db) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING'
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) stmt.run(key, value, now);
}

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? fallback);
}

function setSetting(key, value) {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .run(key, String(value), new Date().toISOString());
}

function audit(user, action, target, detail, ip) {
  getDb()
    .prepare(
      'INSERT INTO audit_logs (user_id, username, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(
      user ? user.user_id : null,
      user ? user.username : null,
      action,
      target === undefined || target === null ? null : String(target),
      detail === undefined || detail === null ? null : String(detail),
      ip || null,
      new Date().toISOString()
    );
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, getSetting, setSetting, audit, closeDb, DATA_DIR, DB_PATH, DEFAULT_SETTINGS };
