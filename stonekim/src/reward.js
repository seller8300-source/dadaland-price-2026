'use strict';
const { getSetting } = require('./db');

/**
 * 리워드 기준.
 * 지급 구조는 "사진 확인 후 최대 5만원" 이며, 실제 금액은 검수 후 관리자가 정한다.
 * (0원 / 1만원 / 3만원 / 5만원 / 직접입력)
 * 고객에게 특정 금액을 확정 약속하지 않도록, 안내 문구는 항상 '확인 후 안내' 를 함께 쓴다.
 */

const PRESET_AMOUNTS = [0, 10000, 30000, 50000];

/** 10000 → '1만원', 15000 → '1만 5천원', 5000 → '5천원' */
function moneyWords(amount) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value === 0) return '0원';
  const man = Math.floor(value / 10000);
  const rest = value % 10000;
  const cheon = Math.floor(rest / 1000);
  if (man && rest === 0) return `${man}만원`;
  if (man && cheon && rest % 1000 === 0) return `${man}만 ${cheon}천원`;
  if (!man && cheon && rest % 1000 === 0) return `${cheon}천원`;
  return `${value.toLocaleString('ko-KR')}원`;
}

/**
 * 현재 리워드 안내 기준.
 * @returns {{max:number, maxWords:string, headline:string, criteria:string, presets:number[]}}
 */
function current() {
  const raw = Number(getSetting('reward_max_amount', '50000'));
  const max = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 50000;
  const maxWords = moneyWords(max);
  return {
    max,
    maxWords,
    headline: `사진 확인 후 최대 ${maxWords}의 시공사례 리워드`,
    criteria: getSetting(
      'reward_criteria_text',
      '등록해주신 사진을 확인한 뒤 리워드 대상 여부와 금액을 개별 안내드립니다. ' +
        '완공된 현장 전체가 잘 보이는 사진일수록 시공사례로 선정될 가능성이 높습니다.'
    ),
    presets: PRESET_AMOUNTS.slice(),
  };
}

/** 관리자 리워드 선택지: 0원 / 1만원 / 3만원 / 5만원 (그 외는 직접입력) */
function presets() {
  return PRESET_AMOUNTS.slice();
}

module.exports = { current, presets, moneyWords, PRESET_AMOUNTS };
