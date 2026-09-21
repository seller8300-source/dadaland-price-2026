'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getDb, getSetting, DATA_DIR } = require('./db');
const { randomToken, nowIso, toDateString } = require('./util');

const UPLOAD_DIR = process.env.STONEKIM_UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
const MAX_BYTES_PER_FILE = Number(process.env.STONEKIM_MAX_FILE_BYTES || 20 * 1024 * 1024);

/** 매직바이트로 실제 이미지 형식을 판별한다 (확장자·MIME 만 믿지 않는다). */
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'].includes(brand)) {
      return { ext: 'heic', mime: 'image/heic', needsConvert: true };
    }
    if (brand === 'avif' || brand === 'avis') {
      return { ext: 'avif', mime: 'image/avif', needsConvert: true };
    }
  }
  return null;
}

function limits() {
  return {
    min: Math.max(1, Number(getSetting('min_photos', '3')) || 3),
    max: Math.max(1, Number(getSetting('max_photos', '10')) || 10),
    maxBytes: MAX_BYTES_PER_FILE,
  };
}

/**
 * 업로드 파일 검증.
 * @returns {{ok: boolean, error?: string, accepted?: Array}}
 */
function validateFiles(files, { existingCount = 0, enforceMin = true } = {}) {
  const { min, max, maxBytes } = limits();
  const accepted = [];
  for (const file of files) {
    if (!file.data || file.data.length === 0) continue;
    if (file.data.length > maxBytes) {
      return { ok: false, error: `사진 1장 용량은 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하여야 합니다.` };
    }
    const kind = sniff(file.data);
    if (!kind) {
      return { ok: false, error: '이미지 파일(JPG·PNG·HEIC)만 등록할 수 있습니다.' };
    }
    accepted.push({ ...file, kind });
  }
  if (enforceMin && accepted.length + existingCount < min) {
    return { ok: false, error: `사진은 최소 ${min}장 이상 등록해 주세요.` };
  }
  if (accepted.length === 0) {
    return { ok: false, error: '등록할 사진을 선택해 주세요.' };
  }
  if (accepted.length + existingCount > max) {
    return { ok: false, error: `사진은 최대 ${max}장까지 등록할 수 있습니다.` };
  }
  return { ok: true, accepted };
}

function relativeDir(projectId, now = new Date()) {
  const [year, month] = toDateString(now).split('-');
  return path.join(String(year), String(month), String(projectId));
}

/** 검증된 파일을 디스크에 저장하고 photos 행을 만든다. */
function storePhotos(projectId, accepted, uploadedBy = 'CUSTOMER') {
  const db = getDb();
  const dir = relativeDir(projectId);
  fs.mkdirSync(path.join(UPLOAD_DIR, dir), { recursive: true });
  const insert = db.prepare(
    `INSERT INTO photos (project_id, file_url, file_name, mime_type, byte_size, needs_convert, uploaded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const saved = [];
  for (const file of accepted) {
    const name = `${Date.now().toString(36)}-${randomToken(8)}.${file.kind.ext}`;
    const relative = path.join(dir, name);
    fs.writeFileSync(path.join(UPLOAD_DIR, relative), file.data);
    insert.run(
      projectId, relative, file.filename || name, file.kind.mime, file.data.length,
      file.kind.needsConvert ? 1 : 0, uploadedBy, nowIso()
    );
    saved.push(relative);
  }
  return saved;
}

/** 트랜잭션 롤백 시 이미 기록된 파일을 정리한다. */
function removeFiles(relativePaths = []) {
  for (const relative of relativePaths) {
    try {
      const full = path.resolve(UPLOAD_DIR, relative);
      if (full.startsWith(path.resolve(UPLOAD_DIR))) fs.unlinkSync(full);
    } catch { /* 파일이 없으면 무시 */ }
  }
}

function listPhotos(projectId) {
  return getDb()
    .prepare('SELECT * FROM photos WHERE project_id = ? ORDER BY is_best DESC, photo_id ASC')
    .all(projectId);
}

function getPhoto(photoId) {
  return getDb().prepare('SELECT * FROM photos WHERE photo_id = ?').get(photoId);
}

function absolutePath(photo) {
  const full = path.resolve(UPLOAD_DIR, photo.file_url);
  if (!full.startsWith(path.resolve(UPLOAD_DIR))) throw new Error('잘못된 경로');
  return full;
}

function setReview(photoId, reviewStatus) {
  getDb().prepare('UPDATE photos SET review_status = ? WHERE photo_id = ?').run(reviewStatus, photoId);
}

function setBest(photoId, isBest) {
  getDb().prepare('UPDATE photos SET is_best = ? WHERE photo_id = ?').run(isBest ? 1 : 0, photoId);
}

function deletePhoto(photoId) {
  const photo = getPhoto(photoId);
  if (!photo) return false;
  try { fs.unlinkSync(absolutePath(photo)); } catch { /* 파일이 이미 없을 수 있다 */ }
  getDb().prepare('DELETE FROM photos WHERE photo_id = ?').run(photoId);
  return true;
}

module.exports = {
  UPLOAD_DIR,
  sniff,
  limits,
  validateFiles,
  storePhotos,
  removeFiles,
  listPhotos,
  getPhoto,
  absolutePath,
  setReview,
  setBest,
  deletePhoto,
};
