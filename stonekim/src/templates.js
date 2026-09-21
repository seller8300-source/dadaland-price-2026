'use strict';
const reward = require('./reward');

/**
 * 알림톡 / SMS 메시지 템플릿.
 * 알림톡은 사전 승인된 템플릿을 사용하므로 본문이 바뀌면 템플릿 재승인이 필요하다.
 * (환경변수 STONEKIM_TPL_FIRST / _SECOND / _FINAL 로 승인된 템플릿 코드를 지정)
 *
 * 리워드 금액은 관리자 설정값에서 주입한다. "최대 5만원" 만 안내하면
 * 실제 기본 리워드 지급 시 고객 불만이 생기므로 기본/최대 기준을 항상 함께 쓴다.
 */

const TYPE_LABEL = {
  FIRST: '1차',
  SECOND: '2차',
  FINAL: '최종',
  TEST: '테스트',
  MANUAL: '수동',
};

const BUTTON_LABEL = {
  FIRST: '시공사진 등록하기',
  SECOND: '사진 등록하고 리워드 신청하기',
  FINAL: '시공사진 등록하기',
  TEST: '시공사진 등록하기',
  MANUAL: '시공사진 등록하기',
};

function first(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다 😊',
    '',
    '구매하신 스톤킴 제품의 시공은 잘 마무리되셨나요?',
    '',
    `완성된 공간의 사진을 보내주시면 사진 확인 후 최대 ${tiers.maxWords}의 시공사례 리워드를 드리고 있습니다.`,
    '',
    '전문 촬영이 아니어도 괜찮습니다.',
    '휴대폰으로 편하게 촬영해주세요.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

function second(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '혹시 시공이 완료되셨다면 완성된 공간을 자랑해주세요 😊',
    '',
    `스톤킴 시공사례로 선정되는 현장에는 최대 ${tiers.maxWords}의 리워드를 드립니다.`,
    '',
    '✓ 전문 촬영 필요 없음',
    '✓ 휴대폰 사진 가능',
    '✓ 등록 약 1분',
    '',
    `▶ 사진 등록하고 리워드 신청하기: ${url}`,
  ].join('\n');
}

function final(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '스톤킴 시공사진 리워드 마지막 안내드립니다.',
    '',
    `시공이 완료된 현장의 사진을 등록해주시면 확인 후 최대 ${tiers.maxWords}의 리워드를 드립니다.`,
    '',
    '간단한 휴대폰 사진도 가능합니다.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

/*
 * 정보성(info) 버전.
 * 알림톡 심사는 혜택·금액 안내를 광고성으로 판단해 반려하는 경우가 많다.
 * 반려되면 이 버전으로 전환하고, 리워드 금액은 업로드 페이지에서 안내한다.
 * (설정 > 메시지 문구 유형 = 정보성)
 */
function firstInfo(url) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '구매하신 스톤킴 제품의 시공이 마무리되셨다면',
    '완성된 현장 사진 등록을 부탁드립니다.',
    '',
    '등록해주신 사진은 제품 품질 확인과 시공사례 검토에 사용되며,',
    '검토 결과는 주문하신 연락처로 안내드립니다.',
    '',
    '전문 촬영이 아니어도 괜찮습니다.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

function secondInfo(url) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '앞서 안내드린 시공사진 등록 관련 재안내드립니다.',
    '',
    '시공이 완료된 현장의 사진을 등록해주시면',
    '검토 후 결과를 안내드립니다.',
    '',
    '✓ 휴대폰 사진 가능',
    '✓ 등록 약 1분',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

function finalInfo(url) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '시공사진 등록 마지막 안내드립니다.',
    '',
    '시공이 완료된 현장의 사진을 등록해주시면',
    '검토 후 결과를 안내드리며, 이후에는 별도로 안내드리지 않습니다.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

const VARIANTS = {
  // 리워드 기준을 본문에 명시 (등록률에 유리하나 심사 반려 위험)
  reward: { FIRST: first, SECOND: second, FINAL: final },
  // 혜택·금액 표현 없는 정보성 문구 (심사 통과에 유리)
  info: { FIRST: firstInfo, SECOND: secondInfo, FINAL: finalInfo },
};

function variantOf(name) {
  return VARIANTS[String(name || '').toLowerCase()] ? String(name).toLowerCase() : 'reward';
}

function buildBody(messageType, uploadUrl, tiers = reward.current(), variant = currentVariant()) {
  const set = VARIANTS[variantOf(variant)];
  const builder = set[messageType] || set.FIRST;
  return builder(uploadUrl, tiers);
}

/** 설정에 저장된 문구 유형 (reward | info) */
function currentVariant() {
  const { getSetting } = require('./db');
  return variantOf(getSetting('message_variant', 'reward'));
}

function templateCode(messageType) {
  const env = {
    FIRST: process.env.STONEKIM_TPL_FIRST,
    SECOND: process.env.STONEKIM_TPL_SECOND,
    FINAL: process.env.STONEKIM_TPL_FINAL,
  };
  return env[messageType] || env.FIRST || null;
}

module.exports = { buildBody, templateCode, currentVariant, variantOf, VARIANTS, TYPE_LABEL, BUTTON_LABEL };
