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
  contractor        TEXT,                    -- 고객이 입력한 시공업체명
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
  reward_base_amount: '10000',
  reward_max_amount: '50000',
  reward_criteria_text:
    '사진 3장 이상을 등록해주시면 확인 후 기본 리워드를 드립니다. ' +
    '완공된 현장이 잘 보이는 사진은 시공사례로 선정되어 추가 리워드를 드립니다. ' +
    '지급까지는 영업일 기준 7일 정도 걸립니다.',
  daily_send_limit: '0',
  // reward = 리워드 기준을 문구에 명시 / info = 혜택 표현 없는 정보성 문구(알림톡 심사 반려 시)
  message_variant: 'reward',
  test_phone: '',
  min_photos: '3',
  max_photos: '10',
  send_hour_kst: '10',
};

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  seedSettings(db);
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
