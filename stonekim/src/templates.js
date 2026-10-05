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
  GUIDE: '시방서',
  FIRST: '1차',
  SECOND: '2차',
  FINAL: '최종',
  TEST: '테스트',
  MANUAL: '수동',
};

const BUTTON_LABEL = {
  GUIDE: '시방서 확인하기',
  FIRST: '시공사진 등록하기',
  SECOND: '사진 등록하고 리워드 신청하기',
  FINAL: '시공사진 등록하기',
  TEST: '시공사진 등록하기',
  MANUAL: '시공사진 등록하기',
};

function benefitLines(tiers) {
  const marks = ['①', '②', '③', '④', '⑤'];
  return tiers.benefits.map((text, index) => `${marks[index] || '·'} ${text}`);
}

function first(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다 😊',
    '',
    '시공은 잘 마무리하셨을까요?',
    '',
    '📸 시공사진 등록 안내',
    ...benefitLines(tiers),
    '',
    '전문 촬영이 아니어도 괜찮습니다.',
    '휴대폰 사진 3장이면 등록이 끝납니다.',
    '',
    `▶ 사진 등록하기: ${url}`,
  ].join('\n');
}

function second(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '앞서 안내드린 시공사진 등록, 아직 등록 전이셔서 다시 안내드립니다.',
    '',
    '📸 시공사진 등록 안내',
    ...benefitLines(tiers),
    '',
    '✓ 전문 촬영 필요 없음',
    '✓ 휴대폰 사진 3장',
    '✓ 소요 시간 약 1분',
    '',
    `▶ 사진 등록하기: ${url}`,
  ].join('\n');
}

function final(url, tiers) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '시공사진 등록 마지막 안내드립니다.',
    '',
    '📸 시공사진 등록 안내',
    ...benefitLines(tiers),
    '',
    '이번 안내 이후에는 별도로 연락드리지 않습니다.',
    '',
    `▶ 사진 등록하기: ${url}`,
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

/**
 * 시방서 안내 (출고 직후).
 * 혜택·금액이 없는 순수 정보성이라 리워드/정보성 구분 없이 한 가지만 쓴다.
 * 승인된 알림톡 템플릿과 문구를 맞춰 둔다.
 */
function guide(url, productGroup) {
  return [
    '안녕하세요, 스톤킴입니다😊',
    '',
    '주문해주셔서 진심으로 감사합니다.',
    '',
    '제품 시공 방법에 대한 시방서를 보내드리오니,',
    '시공 전 아래 시방서를 꼭 확인해 주세요.',
    '자재 보관, 재단, 접착, 마감 주의사항이 담겨 있습니다.',
    '',
    `▶ 시방서 종류: ${productGroup}`,
    '',
    '그 외에 궁금하신 사항이 있으시면 언제든지 연락주세요.',
    '',
    '문의: 1866-1338',
    '',
    `▶ 시방서 확인하기: ${url}`,
  ].join('\n');
}

function currentVariant() {
  const { getSetting } = require('./db');
  return variantOf(getSetting('message_variant', 'reward'));
}

/**
 * 단계별 승인 템플릿 코드.
 * 승인되지 않은 단계를 다른 단계의 코드로 대신 보내면 본문 불일치로 카카오가 거부하므로
 * 폴백하지 않고 null 을 돌려준다(그 경우 문자로 대체발송된다).
 */
function templateCode(messageType) {
  const env = {
    GUIDE: process.env.STONEKIM_TPL_GUIDE,
    FIRST: process.env.STONEKIM_TPL_FIRST,
    SECOND: process.env.STONEKIM_TPL_SECOND,
    FINAL: process.env.STONEKIM_TPL_FINAL,
  };
  return env[messageType] || null;
}

module.exports = { buildBody, guide, templateCode, currentVariant, variantOf, VARIANTS, TYPE_LABEL, BUTTON_LABEL };
