'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/util');

test('휴대폰번호 정규화', () => {
  assert.equal(u.normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(u.normalizePhone(' 010 1234 5678 '), '01012345678');
  assert.equal(u.normalizePhone('+82 10-1234-5678'), '01012345678');
  assert.equal(u.normalizePhone('1012345678'), '01012345678'); // 엑셀에서 앞 0 이 사라진 경우
  assert.equal(u.normalizePhone('01112345678'), '01112345678');
  assert.equal(u.normalizePhone('02-555-1234'), null); // 유선번호 불가
  assert.equal(u.normalizePhone('010-123-45'), null);
  assert.equal(u.normalizePhone(''), null);
  assert.equal(u.normalizePhone(null), null);
});

test('전화번호 마스킹은 뒤 4자리를 가린다', () => {
  assert.equal(u.maskPhone('01012345678'), '010-1234-****');
  assert.equal(u.formatPhone('01012345678'), '010-1234-5678');
});

test('날짜 정규화 (문자열·엑셀 시리얼)', () => {
  assert.equal(u.normalizeDate('2026-09-22'), '2026-09-22');
  assert.equal(u.normalizeDate('2026/9/5'), '2026-09-05');
  assert.equal(u.normalizeDate('20260905'), '2026-09-05');
  assert.equal(u.normalizeDate('2026년 9월 5일'), '2026-09-05');
  assert.equal(u.normalizeDate(46287), '2026-09-22'); // 엑셀 날짜 시리얼
  assert.equal(u.normalizeDate('없음'), null);
  assert.equal(u.normalizeDate(''), null);
});

test('발송 예정 시각은 KST 지정 시각으로 계산된다', () => {
  const at = u.dateStringPlusDays('2026-09-20', 14, 10);
  assert.equal(at, '2026-10-04T01:00:00.000Z'); // KST 10:00 = UTC 01:00
  assert.equal(u.toDateString(new Date(at)), '2026-10-04');
});

test('직전 발송 시각 기준 후속 일정', () => {
  const next = u.isoPlusDaysAtHour('2026-09-22T01:00:00.000Z', 7, 10);
  assert.equal(next, '2026-09-29T01:00:00.000Z');
});

test('HTML 이스케이프', () => {
  assert.equal(u.escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});
