'use strict';
const { getSetting } = require('./db');

/**
 * 고객에게 보여줄 리워드 안내.
 * 승인된 알림톡 템플릿의 혜택 내용과 화면 문구가 어긋나면 고객 불만으로 이어지므로,
 * 문구는 전부 설정값으로 두고 관리자가 한 곳에서 맞춘다.
 */

const PRESET_AMOUNTS = [0, 10000, 30000, 50000, 100000];

const DEFAULT_HEADLINE = '사진 등록만 하셔도 신세계상품권 3만원 🎁';
const DEFAULT_BENEFITS = [
  '💳 등록 고객 100% 신세계상품권 3만원',
  '🏆 매월 BEST 선정 시 10만원 추가 지급',
  '📢 우수 시공사례는 스톤킴 공식 채널 게시',
].join('\n');
const DEFAULT_CRITERIA =
  '완공된 현장이 잘 보이는 사진 3장 이상을 등록해주세요. ' +
  '확인 후 등록하신 연락처로 지급 안내를 드립니다.';

/** 10000 → '1만원', 15000 → '1만 5천원' */
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
 * @returns {{headline:string, benefits:string[], criteria:string, presets:number[]}}
 */
function current() {
  return {
    headline: getSetting('reward_headline', DEFAULT_HEADLINE),
    benefits: String(getSetting('reward_benefits', DEFAULT_BENEFITS))
      .split('\n')
      .map((line) => line.replace(/^[①②③④⑤\d.)\s-]+/, '').trim())
      .filter(Boolean),
    criteria: getSetting('reward_criteria_text', DEFAULT_CRITERIA),
    presets: PRESET_AMOUNTS.slice(),
  };
}

/** 관리자 지급 선택지 */
function presets() {
  return PRESET_AMOUNTS.slice();
}

module.exports = { current, presets, moneyWords, PRESET_AMOUNTS, DEFAULT_HEADLINE, DEFAULT_BENEFITS, DEFAULT_CRITERIA };
