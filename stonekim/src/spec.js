'use strict';
const { getSetting } = require('./db');

/**
 * 시방서(시공 방법 안내) 안내용 제품군 판별.
 *
 * 시방서는 한 링크 안에 제품군별 탭으로 나뉘어 있어서, 고객에게는 '어느 탭을 보면 되는지'만
 * 알려주면 된다. 품목명 앞머리 코드로 제품군을 찾는다.
 *
 * 설정(spec_groups)은 한 줄에 하나씩 `코드=제품군` 형태다.
 *   SF=소프트스톤
 *   IP=콕스톤
 * 코드는 품목명에 '들어 있으면' 맞는 것으로 본다. 긴 코드를 먼저 보므로
 * SF20-2 와 SF 가 같이 있어도 SF20-2 가 이긴다.
 */

/** 어느 제품군도 못 찾았을 때 메시지에 넣을 말. 알림톡 변수는 비우면 발송이 실패한다. */
const FALLBACK = '주문하신 제품';

function groups() {
  return String(getSetting('spec_groups', ''))
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      if (index < 0) return null;
      const code = line.slice(0, index).trim();
      const label = line.slice(index + 1).trim();
      return code && label ? { code, label } : null;
    })
    .filter(Boolean)
    // 긴 코드부터 본다 (SF20-2 가 SF 보다 먼저 걸리도록)
    .sort((a, b) => b.code.length - a.code.length);
}

/**
 * 품목명에서 제품군 이름을 찾는다.
 * @param {string} product 예: '[SF20-2]T-A015 [600*1200] 외 3건'
 * @returns {string} 제품군 이름, 못 찾으면 FALLBACK
 */
function groupFor(product) {
  const text = String(product || '').toLowerCase();
  if (!text) return FALLBACK;

  const matched = groups().filter(({ code }) => text.includes(code.toLowerCase()));
  // SF29 가 걸렸으면 SF 는 같은 글자를 다시 집은 것이므로 버린다.
  // 반대로 SF 와 IP 는 서로 무관하므로 둘 다 남는다 (한 전표에 제품군이 섞인 경우).
  const specific = matched.filter(
    ({ code }) => !matched.some((other) => other.code !== code && other.code.toLowerCase().includes(code.toLowerCase()))
  );

  const labels = [];
  for (const { label } of specific) {
    if (!labels.includes(label)) labels.push(label);
  }
  if (!labels.length) return FALLBACK;
  return labels.join(', ');
}

/** 시방서 링크 (설정에 없으면 빈 문자열) */
function link() {
  return String(getSetting('spec_link', '')).trim();
}

/** 시방서 안내를 자동 발송할지 여부. 링크가 없으면 켜져 있어도 보내지 않는다. */
function enabled() {
  return getSetting('spec_enabled', '0') === '1' && !!link();
}

module.exports = { groups, groupFor, link, enabled, FALLBACK };
