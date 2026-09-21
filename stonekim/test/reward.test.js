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
  assert.equal(reward.moneyWords(15000), '1만 5천원');
  assert.equal(reward.moneyWords(5000), '5천원');
  assert.equal(reward.moneyWords(12345), '12,345원');
  assert.equal(reward.moneyWords(0), '0원');
});

test('기본 리워드와 최대 리워드를 함께 안내한다', () => {
  const tiers = reward.current();
  assert.equal(tiers.base, 10000);
  assert.equal(tiers.max, 50000);
  assert.match(tiers.headline, /사진 등록만 하셔도 1만원/);
  assert.match(tiers.headline, /선정되면 최대 5만원/);
  assert.equal(tiers.lines.length, 2);
  assert.ok(tiers.criteria.length > 10, '지급 기준 설명이 있어야 한다');
});

test('메시지 3종 모두 기본/최대 기준을 함께 표시한다', () => {
  for (const type of ['FIRST', 'SECOND', 'FINAL']) {
    const body = templates.buildBody(type, 'https://x/y');
    assert.match(body, /사진 등록 확인 시 1만원/, `${type} 메시지에 기본 리워드 누락`);
    assert.match(body, /선정 시 최대 5만원/, `${type} 메시지에 최대 리워드 누락`);
    assert.doesNotMatch(
      body.split('\n').find((line) => line.includes('최대')) || '',
      /^최대 5만원의 리워드를 드립니다\.$/,
      '최대 금액만 단독으로 안내하지 않는다'
    );
  }
});

test('관리자가 금액을 바꾸면 고객 문구도 함께 바뀐다', () => {
  setSetting('reward_base_amount', 20000);
  setSetting('reward_max_amount', 70000);
  const tiers = reward.current();
  assert.equal(tiers.baseWords, '2만원');
  assert.equal(tiers.maxWords, '7만원');
  const body = templates.buildBody('FIRST', 'https://x/y');
  assert.match(body, /사진 등록 확인 시 2만원/);
  assert.match(body, /최대 7만원/);
});

test('최대 금액이 기본 금액보다 작으면 기본 금액으로 맞춘다', () => {
  setSetting('reward_base_amount', 30000);
  setSetting('reward_max_amount', 10000);
  const tiers = reward.current();
  assert.equal(tiers.max, 30000);
});

test('관리자 지급 선택지는 설정 금액에서 만들어진다', () => {
  setSetting('reward_base_amount', 10000);
  setSetting('reward_max_amount', 50000);
  const presets = reward.presets();
  assert.deepEqual(presets, [0, 10000, 30000, 50000]);
});
