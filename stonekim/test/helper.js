'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 테스트마다 격리된 임시 DB/업로드 디렉터리를 쓴다. (require 최상단에서 호출) */
function useTempData(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `stonekim-${label}-`));
  process.env.STONEKIM_DATA_DIR = dir;
  process.env.STONEKIM_DB = path.join(dir, 'test.db');
  process.env.STONEKIM_UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.STONEKIM_BASE_URL = 'http://test.local';
  process.env.STONEKIM_QUIET = '1';
  return dir;
}

/** 최소 크기의 진짜 JPEG 바이트 (매직바이트 검증용) */
function jpegBytes(size = 1024) {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const tail = Buffer.alloc(Math.max(0, size - head.length - 2), 0x20);
  return Buffer.concat([head, tail, Buffer.from([0xff, 0xd9])]);
}

function pngBytes(size = 512) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0)]);
}

function heicBytes(size = 512) {
  const head = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypheic', 'ascii'),
  ]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0)]);
}

/** multipart/form-data 본문 생성 */
function buildMultipart(fields = {}, files = []) {
  const boundary = '----stonekimtest' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8'
      )
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType || 'image/jpeg'}\r\n\r\n`,
        'utf8'
      ),
      file.data,
      Buffer.from('\r\n', 'utf8')
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

module.exports = { useTempData, jpegBytes, pngBytes, heicBytes, buildMultipart };
