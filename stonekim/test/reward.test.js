'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempData } = require('./helper');
useTempData('reward');

const { setSetting } = require('../src/db');
const reward = require('../src/reward');
const templates = require('../src/templates');

test('금액을 읽기 쉬운 한글 표기로 바꾼다', () => {
  assert.equal(reward.moneyWords(10000), '1만원');
  assert.equal(reward.moneyWords(50000), '5만원');
  assert.equal(reward.moneyWords(30000), '3만원');
  assert.equal(reward.moneyWords(15000), '1만 5천원');
  assert.equal(reward.moneyWords(12345), '12,345원');
  assert.equal(reward.moneyWords(0), '0원');
});

test('지급 구조는 "확인 후 최대 5만원" 이며 확정 금액을 약속하지 않는다', () => {
  const tiers = reward.current();
  assert.equal(tiers.max, 50000);
  assert.equal(tiers.headline, '사진 확인 후 최대 5만원의 시공사례 리워드');
  assert.match(tiers.criteria, /확인한 뒤 리워드 대상 여부와 금액을 개별 안내/);
  assert.equal(tiers.base, undefined, '무조건 지급되는 기본 금액 개념은 두지 않는다');
});

test('관리자 지급 선택지는 0 / 1만 / 3만 / 5만원', () => {
  assert.deepEqual(reward.presets(), [0, 10000, 30000, 50000]);
});

test('리워드 명시 버전 메시지는 최대 금액만 안내한다', () => {
  const body = templates.buildBody('FIRST', 'https://x/y', reward.current(), 'reward');
  assert.match(body, /사진 확인 후 최대 5만원의 시공사례 리워드를 드리고 있습니다/);
  assert.doesNotMatch(body, /등록만 하셔도/);
  assert.doesNotMatch(body, /사진 등록 확인 시 1만원/);
});

test('기본 문구 유형은 정보성(금액 비노출)이다 — 알림톡 심사 대비', () => {
  assert.equal(templates.currentVariant(), 'info');
  for (const type of ['FIRST', 'SECOND', 'FINAL']) {
    const body = templates.buildBody(type, 'https://x/y');
    assert.doesNotMatch(body, /만원|리워드|혜택|사은품/, `${type} 정보성 문구에 혜택 표현이 남아있다`);
    assert.match(body, /시공사진 등록하기: https:\/\/x\/y/);
  }
});

test('최대 금액을 바꾸면 안내 문구도 함께 바뀐다', () => {
  setSetting('reward_max_amount', 70000);
  assert.equal(reward.current().maxWords, '7만원');
  assert.match(templates.buildBody('FIRST', 'https://x/y', reward.current(), 'reward'), /최대 7만원/);
  setSetting('reward_max_amount', 50000);
});
