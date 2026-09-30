'use strict';
const crypto = require('node:crypto');
const { getDb, audit } = require('./db');
const { randomToken, nowIso, safeEqual } = require('./util');

const SESSION_HOURS = Number(process.env.STONEKIM_SESSION_HOURS || 12);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createUser(username, password, displayName, options = {}) {
  const db = getDb();
  const role = options.role === 'OWNER' ? 'OWNER' : 'STAFF';
  db.prepare(
    `INSERT INTO admin_users (username, password_hash, display_name, role, active, must_change_password, created_at)
     VALUES (?,?,?,?,1,?,?)`
  ).run(username, hashPassword(password), displayName || username, role,
    options.mustChangePassword ? 1 : 0, nowIso());
  return db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
}

/** 계정 관리 화면용 목록 (비밀번호 해시는 내보내지 않는다) */
function listUsers() {
  return getDb()
    .prepare(
      `SELECT user_id, username, display_name, role, active, must_change_password, last_login_at, created_at
         FROM admin_users ORDER BY user_id`
    )
    .all();
}

function getUser(userId) {
  return getDb()
    .prepare(
      `SELECT user_id, username, display_name, role, active, must_change_password, last_login_at, created_at
         FROM admin_users WHERE user_id = ?`
    )
    .get(userId);
}

function countOwners() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM admin_users WHERE role = 'OWNER' AND active = 1").get().c;
}

/** 계정을 켜고 끈다. 끄면 로그인 세션도 그 자리에서 끊긴다. */
function setActive(userId, active) {
  getDb().prepare('UPDATE admin_users SET active = ? WHERE user_id = ?').run(active ? 1 : 0, userId);
  if (!active) getDb().prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
}

function setRole(userId, role) {
  getDb().prepare('UPDATE admin_users SET role = ? WHERE user_id = ?')
    .run(role === 'OWNER' ? 'OWNER' : 'STAFF', userId);
}

/** 관리자가 직원 비밀번호를 초기화한다. 직원은 다음 로그인에서 반드시 바꿔야 한다. */
function resetPassword(userId) {
  const temporary = randomToken(6);
  getDb()
    .prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 1 WHERE user_id = ?')
    .run(hashPassword(temporary), userId);
  getDb().prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
  return temporary;
}

function findUser(username) {
  return getDb().prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
}

function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
}

/** 최초 기동 시 관리자 계정이 없으면 기본 계정을 만든다. */
function ensureBootstrapUser() {
  if (countUsers() > 0) return null;
  const username = process.env.STONEKIM_ADMIN_USER || 'admin';
  const password = process.env.STONEKIM_ADMIN_PASSWORD || randomToken(9);
  createUser(username, password, '관리자', { role: 'OWNER' });
  return { username, password, generated: !process.env.STONEKIM_ADMIN_PASSWORD };
}

function login(username, password, ip) {
  const user = findUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    audit(null, 'LOGIN_FAILED', username, null, ip);
    return null;
  }
  if (!user.active) {
    audit(null, 'LOGIN_DISABLED', username, null, ip);
    return null;
  }
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  getDb()
    .prepare('INSERT INTO admin_sessions (token, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, user.user_id, csrf, nowIso(), expires);
  getDb().prepare('UPDATE admin_users SET last_login_at = ? WHERE user_id = ?').run(nowIso(), user.user_id);
  audit(user, 'LOGIN', username, null, ip);
  return { token, csrf, user, expires };
}

function sessionFromToken(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.token, s.csrf, s.expires_at, u.user_id, u.username, u.display_name,
              u.role, u.active, u.must_change_password
         FROM admin_sessions s JOIN admin_users u ON u.user_id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    logout(token);
    return null;
  }
  if (!row.active) {
    logout(token);
    return null;
  }
  return row;
}

function logout(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

function purgeExpiredSessions() {
  getDb().prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(nowIso());
}

function checkCsrf(session, submitted) {
  return !!session && safeEqual(session.csrf, submitted);
}

function changePassword(userId, newPassword) {
  getDb()
    .prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?')
    .run(hashPassword(newPassword), userId);
  getDb().prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
}

function isOwner(session) {
  return !!session && session.role === 'OWNER';
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
  listUsers,
  getUser,
  countOwners,
  setActive,
  setRole,
  resetPassword,
  isOwner,
  findUser,
  countUsers,
  ensureBootstrapUser,
  login,
  logout,
  sessionFromToken,
  purgeExpiredSessions,
  checkCsrf,
  changePassword,
  SESSION_HOURS,
};
