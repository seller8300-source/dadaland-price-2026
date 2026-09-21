'use strict';
const { getSetting } = require('./db');

/**
 * 리워드 지급 기준.
 * "최대 5만원" 만 노출하면 실제 1만원 지급 시 고객 불만으로 이어지므로,
 * 고객에게 보이는 모든 문구(알림톡·업로드 화면)에서 기본/최대 기준을 함께 안내한다.
 */

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

function amountSetting(key, fallback) {
  const raw = Number(getSetting(key, String(fallback)));
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : fallback;
}

/**
 * 현재 설정된 리워드 기준.
 * @returns {{base:number, max:number, baseWords:string, maxWords:string,
 *            headline:string, lines:string[], criteria:string}}
 */
function current() {
  const base = amountSetting('reward_base_amount', 10000);
  const max = Math.max(base, amountSetting('reward_max_amount', 50000));
  const baseWords = moneyWords(base);
  const maxWords = moneyWords(max);
  return {
    base,
    max,
    baseWords,
    maxWords,
    headline: `사진 등록만 하셔도 ${baseWords}, 시공사례로 선정되면 최대 ${maxWords}`,
    lines: [
      `사진 등록 확인 시 ${baseWords}`,
      `스톤킴 시공사례로 선정 시 최대 ${maxWords}`,
    ],
    criteria: getSetting(
      'reward_criteria_text',
      '사진 3장 이상을 등록해주시면 확인 후 기본 리워드를 드립니다. ' +
        '완공된 현장이 잘 보이는 사진은 시공사례로 선정되어 추가 리워드를 드립니다. ' +
        '지급까지는 영업일 기준 7일 정도 걸립니다.'
    ),
  };
}

/** 관리자 리워드 선택지 (기준 금액에서 자동 생성) */
function presets(tiers = current()) {
  const middle = Math.round((tiers.base + tiers.max) / 2 / 10000) * 10000;
  const amounts = [0, tiers.base, middle, tiers.max].filter(
    (value, index, all) => value >= 0 && all.indexOf(value) === index
  );
  return amounts.sort((a, b) => a - b);
}

module.exports = { current, presets, moneyWords };
