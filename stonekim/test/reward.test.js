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
  assert.equal(reward.moneyWords(30000), '3만원');
  assert.equal(reward.moneyWords(100000), '10만원');
  assert.equal(reward.moneyWords(15000), '1만 5천원');
  assert.equal(reward.moneyWords(0), '0원');
});

test('기본 안내는 승인된 알림톡 이벤트 내용과 같다', () => {
  const tiers = reward.current();
  assert.match(tiers.headline, /신세계상품권 3만원/);
  assert.equal(tiers.benefits.length, 3);
  assert.match(tiers.benefits[0], /100% 신세계상품권 3만원/);
  assert.match(tiers.benefits[1], /BEST 선정 시 10만원/);
  assert.ok(tiers.criteria.length > 10);
});

test('관리자 지급 선택지에 상품권 3만원과 BEST 10만원이 있다', () => {
  assert.deepEqual(reward.presets(), [0, 10000, 30000, 50000, 100000]);
});

test('혜택 문구를 바꾸면 고객 안내와 문자 본문이 함께 바뀐다', () => {
  setSetting('reward_headline', '사진 등록하고 5만원 받기');
  setSetting('reward_benefits', '등록 고객 전원 5만원\n우수 현장 추가 지급');

  const tiers = reward.current();
  assert.equal(tiers.headline, '사진 등록하고 5만원 받기');
  assert.deepEqual(tiers.benefits, ['등록 고객 전원 5만원', '우수 현장 추가 지급']);

  const body = templates.buildBody('FIRST', 'https://x/y', tiers, 'reward');
  assert.match(body, /① 등록 고객 전원 5만원/);
  assert.match(body, /② 우수 현장 추가 지급/);

  setSetting('reward_headline', reward.DEFAULT_HEADLINE);
  setSetting('reward_benefits', reward.DEFAULT_BENEFITS);
});

test('혜택 목록 앞의 번호 기호는 정리해서 읽는다', () => {
  setSetting('reward_benefits', '① 첫 번째\n② 두 번째');
  assert.deepEqual(reward.current().benefits, ['첫 번째', '두 번째']);
  setSetting('reward_benefits', reward.DEFAULT_BENEFITS);
});

test('기본 문구 유형은 정보성(금액 비노출)이다 — 알림톡 심사 대비', () => {
  assert.equal(templates.currentVariant(), 'info');
  for (const type of ['FIRST', 'SECOND', 'FINAL']) {
    const body = templates.buildBody(type, 'https://x/y');
    assert.doesNotMatch(body, /만원|상품권|이벤트/, `${type} 정보성 문구에 혜택 표현이 남아있다`);
  }
});
