'use strict';
/**
 * 알림톡 / SMS 메시지 템플릿.
 * 알림톡은 사전 승인된 템플릿을 사용하므로 본문이 바뀌면 템플릿 재승인이 필요하다.
 * (환경변수 STONEKIM_TPL_FIRST / _SECOND / _FINAL 로 승인된 템플릿 코드를 지정)
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

function first(url) {
  return [
    '안녕하세요, 스톤킴입니다 😊',
    '',
    '구매하신 스톤킴 제품의 시공은 잘 마무리되셨나요?',
    '',
    '완성된 공간의 사진을 보내주시면 사진 확인 후 최대 5만원의 시공사례 리워드를 드리고 있습니다.',
    '',
    '전문 촬영이 아니어도 괜찮습니다.',
    '휴대폰으로 편하게 촬영해주세요.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

function second(url) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '혹시 시공이 완료되셨다면 완성된 공간을 자랑해주세요 😊',
    '',
    '스톤킴 시공사례로 선정되는 현장에는 최대 5만원의 리워드를 드립니다.',
    '',
    '✓ 전문 촬영 필요 없음',
    '✓ 휴대폰 사진 가능',
    '✓ 등록 약 1분',
    '',
    `▶ 사진 등록하고 리워드 신청하기: ${url}`,
  ].join('\n');
}

function final(url) {
  return [
    '안녕하세요, 스톤킴입니다.',
    '',
    '스톤킴 시공사진 리워드 마지막 안내드립니다.',
    '',
    '시공이 완료된 현장의 사진을 등록해주시면 확인 후 최대 5만원의 리워드를 드립니다.',
    '',
    '간단한 휴대폰 사진도 가능합니다.',
    '',
    `▶ 시공사진 등록하기: ${url}`,
  ].join('\n');
}

const BUILDERS = { FIRST: first, SECOND: second, FINAL: final, TEST: first, MANUAL: first };

function buildBody(messageType, uploadUrl) {
  const builder = BUILDERS[messageType] || first;
  return builder(uploadUrl);
}

function templateCode(messageType) {
  const env = {
    FIRST: process.env.STONEKIM_TPL_FIRST,
    SECOND: process.env.STONEKIM_TPL_SECOND,
    FINAL: process.env.STONEKIM_TPL_FINAL,
  };
  return env[messageType] || env.FIRST || null;
}

module.exports = { buildBody, templateCode, TYPE_LABEL, BUTTON_LABEL };
