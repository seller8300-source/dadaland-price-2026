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

function createUser(username, password, displayName) {
  const db = getDb();
  db.prepare(
    'INSERT INTO admin_users (username, password_hash, display_name, created_at) VALUES (?,?,?,?)'
  ).run(username, hashPassword(password), displayName || username, nowIso());
  return db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
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
  createUser(username, password, '관리자');
  return { username, password, generated: !process.env.STONEKIM_ADMIN_PASSWORD };
}

function login(username, password, ip) {
  const user = findUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    audit(null, 'LOGIN_FAILED', username, null, ip);
    return null;
  }
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  getDb()
    .prepare('INSERT INTO admin_sessions (token, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, user.user_id, csrf, nowIso(), expires);
  audit(user, 'LOGIN', username, null, ip);
  return { token, csrf, user, expires };
}

function sessionFromToken(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.token, s.csrf, s.expires_at, u.user_id, u.username, u.display_name
         FROM admin_sessions s JOIN admin_users u ON u.user_id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
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
    .prepare('UPDATE admin_users SET password_hash = ? WHERE user_id = ?')
    .run(hashPassword(newPassword), userId);
  getDb().prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
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
