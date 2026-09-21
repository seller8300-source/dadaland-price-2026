'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useTempData, jpegBytes, pngBytes, heicBytes, buildMultipart } = require('./helper');
useTempData('photos');

const { getDb, setSetting } = require('../src/db');
const photos = require('../src/photos');
const multipart = require('../src/multipart');
const { nowIso, randomToken } = require('../src/util');

let phoneSeq = 0;

function makeProject() {
  const db = getDb();
  phoneSeq += 1;
  db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)')
    .run('테스트', '0101234' + String(1000 + phoneSeq).slice(-4), nowIso());
  const customerId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  db.prepare(
    `INSERT INTO projects (order_number, customer_id, ship_date, upload_token, status, created_at, updated_at)
     VALUES (?,?,?,?, 'READY', ?, ?)`
  ).run('P' + randomToken(4), customerId, '2026-09-20', randomToken(), nowIso(), nowIso());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

test('이미지 형식은 매직바이트로 판별한다', () => {
  assert.deepEqual(photos.sniff(jpegBytes()), { ext: 'jpg', mime: 'image/jpeg' });
  assert.deepEqual(photos.sniff(pngBytes()), { ext: 'png', mime: 'image/png' });
  const heic = photos.sniff(heicBytes());
  assert.equal(heic.ext, 'heic');
  assert.equal(heic.needsConvert, true, 'HEIC 는 변환 필요 표시');
  assert.equal(photos.sniff(Buffer.from('<?php echo 1; ?>                ')), null, '이미지가 아니면 거부');
  assert.equal(photos.sniff(Buffer.alloc(4)), null);
});

test('최소/최대 장수를 검증한다', () => {
  setSetting('min_photos', 3);
  setSetting('max_photos', 10);
  const file = (i) => ({ field: 'photos', filename: `a${i}.jpg`, data: jpegBytes(300) });

  const tooFew = photos.validateFiles([file(1), file(2)]);
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.error, /최소 3장/);

  const ok = photos.validateFiles([file(1), file(2), file(3)]);
  assert.equal(ok.ok, true);
  assert.equal(ok.accepted.length, 3);

  const tooMany = photos.validateFiles(Array.from({ length: 11 }, (_, i) => file(i)));
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /최대 10장/);

  const bad = photos.validateFiles([file(1), file(2), { field: 'photos', filename: 'x.exe', data: Buffer.alloc(40) }]);
  assert.equal(bad.ok, false);
});

test('관리자 직접 등록은 최소 장수를 요구하지 않는다', () => {
  const single = photos.validateFiles([{ field: 'photos', filename: 'a.jpg', data: jpegBytes(300) }], {
    enforceMin: false,
  });
  assert.equal(single.ok, true);
});

test('사진을 저장하고 경로 탈출을 막는다', () => {
  const projectId = makeProject();
  const files = [1, 2, 3].map((i) => ({ field: 'photos', filename: `../../evil${i}.jpg`, data: jpegBytes(500) }));
  const validation = photos.validateFiles(files);
  photos.storePhotos(projectId, validation.accepted);

  const rows = photos.listPhotos(projectId);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const full = photos.absolutePath(row);
    assert.ok(full.startsWith(path.resolve(photos.UPLOAD_DIR)), '업로드 디렉터리를 벗어나지 않는다');
    assert.ok(fs.existsSync(full));
    assert.match(path.basename(full), /^[a-z0-9-]+\.jpg$/i, '파일명은 서버가 생성한다');
  }
});

test('검수 상태와 BEST 지정', () => {
  const projectId = makeProject();
  const validation = photos.validateFiles([1, 2, 3].map((i) => ({ field: 'photos', filename: `b${i}.jpg`, data: jpegBytes(300) })));
  photos.storePhotos(projectId, validation.accepted);
  const [first] = photos.listPhotos(projectId);

  photos.setReview(first.photo_id, 'USABLE');
  photos.setBest(first.photo_id, true);
  const updated = photos.getPhoto(first.photo_id);
  assert.equal(updated.review_status, 'USABLE');
  assert.equal(updated.is_best, 1);

  photos.deletePhoto(first.photo_id);
  assert.equal(photos.getPhoto(first.photo_id), undefined);
});

test('multipart 본문에서 필드와 파일을 분리한다', () => {
  const { body, contentType } = buildMultipart(
    { consent: '1', region: '서울 강남', review_text: '만족합니다' },
    [
      { field: 'photos', filename: '사진1.jpg', data: jpegBytes(200) },
      { field: 'photos', filename: '사진2.heic', data: heicBytes(200), contentType: 'image/heic' },
    ]
  );
  const parsed = multipart.parse(body, contentType);
  assert.equal(parsed.fields.consent, '1');
  assert.equal(parsed.fields.region, '서울 강남');
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].filename, '사진1.jpg');
  assert.equal(photos.sniff(parsed.files[1].data).ext, 'heic', '파일 바이트가 손상 없이 전달된다');
});
