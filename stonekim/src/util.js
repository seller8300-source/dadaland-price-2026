'use strict';
const crypto = require('node:crypto');

const KST_OFFSET_MIN = 9 * 60;

/** 추측 불가능한 URL 토큰 (base64url, 32바이트 = 256bit) */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * 휴대폰번호 정규화.
 * '010-1234-5678', '+82 10 1234 5678', '01012345678' → '01012345678'
 * 형식이 유효하지 않으면 null.
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // 엑셀에서 숫자로 읽혀 선행 0이 사라진 경우 보정 (1012345678 → 01012345678)
  s = s.replace(/[\s.\-()]/g, '');
  if (s.startsWith('+82')) s = '0' + s.slice(3);
  else if (s.startsWith('82') && s.length >= 12) s = '0' + s.slice(2);
  if (/^1[01][0-9]{8}$/.test(s)) s = '0' + s;
  if (!/^01[0-9]{8,9}$/.test(s)) return null;
  return s;
}

/** 화면 노출용 마스킹: 01012345678 → 010-1234-**** */
function maskPhone(phone) {
  const p = String(phone || '').replace(/[^0-9]/g, '');
  if (p.length < 8) return p;
  const f = formatPhone(p);
  return f.slice(0, f.lastIndexOf('-') + 1) + '****';
}

function formatPhone(phone) {
  if (!phone) return '';
  const p = String(phone).replace(/[^0-9]/g, '');
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

/**
 * 다양한 형식의 날짜 입력을 'YYYY-MM-DD' 로 정규화.
 * 지원: Date, 엑셀 시리얼 숫자, '2026-09-20', '2026/9/20', '20260920', '9/20' (올해 기준)
 * 실패 시 null.
 */
function normalizeDate(raw, today = new Date()) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !isNaN(raw)) return toDateString(raw);
  let s = String(raw).trim();
  if (!s) return null;

  // 엑셀 날짜 시리얼 (1900 시스템)
  if (/^[0-9]{5}(\.[0-9]+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    const ms = (serial - 25569) * 86400000; // 25569 = 1970-01-01
    const d = new Date(ms);
    if (!isNaN(d)) return toDateString(d);
  }
  s = s.replace(/[.\s]+$/g, '');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return pad4(m[1]) + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${today.getFullYear()}-${pad2(m[1])}-${pad2(m[2])}`;
  m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  return null;
}

function pad2(v) { return String(v).padStart(2, '0'); }
function pad4(v) { return String(v).padStart(4, '0'); }

/** Date → 'YYYY-MM-DD' (KST 기준) */
function toDateString(date) {
  const kst = new Date(date.getTime() + KST_OFFSET_MIN * 60000);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
}

/** 'YYYY-MM-DD' 에 days 를 더한 뒤 KST hour 시각의 UTC ISO 문자열 반환 */
function dateStringPlusDays(dateStr, days, hourKst = 10) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, hourKst - 9, 0, 0, 0);
  return new Date(ms).toISOString();
}

/** ISO 시각 + days 후, KST hourKst 시각 */
function isoPlusDaysAtHour(iso, days, hourKst = 10) {
  const base = new Date(iso);
  if (isNaN(base)) return null;
  return dateStringPlusDays(toDateString(base), days, hourKst);
}

function nowIso() { return new Date().toISOString(); }

/** ISO → '09/22 14:30' (KST) */
function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const k = new Date(d.getTime() + KST_OFFSET_MIN * 60000);
  return `${pad2(k.getUTCMonth() + 1)}/${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD' → '09/22' */
function fmtDate(dateStr) {
  if (!dateStr) return '-';
  const m = String(dateStr).match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : String(dateStr);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function won(amount) {
  return Number(amount || 0).toLocaleString('ko-KR') + '원';
}

/** 타이밍 공격에 안전한 문자열 비교 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  KST_OFFSET_MIN,
  randomToken,
  normalizePhone,
  maskPhone,
  formatPhone,
  normalizeDate,
  toDateString,
  dateStringPlusDays,
  isoPlusDaysAtHour,
  nowIso,
  fmtDateTime,
  fmtDate,
  escapeHtml,
  won,
  safeEqual,
};
