'use strict';
const { randomToken, normalizePhone } = require('./util');
const templates = require('./templates');

/**
 * 발송 채널 어댑터.
 * 기본은 mock(실제 발송 없음) 이며, 환경변수가 설정되면 HTTP 게이트웨이를 호출한다.
 *   STONEKIM_MSG_PROVIDER=http
 *   STONEKIM_ALIMTALK_ENDPOINT / STONEKIM_SMS_ENDPOINT / STONEKIM_MSG_API_KEY / STONEKIM_MSG_SENDER
 * 실제 사업자(솔라피·NHN 등)에 맞춘 요청 형식은 이 파일만 수정하면 된다.
 */

/** SMS(90바이트) 초과 시 LMS. 한글은 EUC-KR 기준 2바이트로 계산한다. */
function smsByteLength(text) {
  let bytes = 0;
  for (const ch of String(text)) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

function smsChannel(text) {
  return smsByteLength(text) > 90 ? 'LMS' : 'SMS';
}

function provider() {
  return (process.env.STONEKIM_MSG_PROVIDER || 'mock').toLowerCase();
}

async function postJson(url, payload, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
  if (!res.ok) {
    const reason = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
    return { ok: false, error: `${res.status} ${reason}` };
  }
  return { ok: true, ref: (json && (json.messageId || json.id || json.requestId)) || null };
}

/** 알림톡 1건 발송 시도 */
async function sendAlimtalk({ phone, body, messageType }) {
  if (provider() === 'http') {
    const endpoint = process.env.STONEKIM_ALIMTALK_ENDPOINT;
    if (!endpoint) return { ok: false, error: 'ALIMTALK_ENDPOINT 미설정' };
    return postJson(
      endpoint,
      {
        to: phone,
        from: process.env.STONEKIM_MSG_SENDER,
        senderKey: process.env.STONEKIM_ALIMTALK_SENDER_KEY,
        templateCode: templates.templateCode(messageType),
        text: body,
      },
      process.env.STONEKIM_MSG_API_KEY
    );
  }
  // mock: 실제 발송 없이 성공 처리. 대체발송 경로 점검을 위해 실패율을 줄 수 있다.
  const failRate = Number(process.env.STONEKIM_MOCK_ALIMTALK_FAIL_RATE || 0);
  if (!normalizePhone(phone)) return { ok: false, error: '휴대폰번호 형식 오류' };
  if (failRate > 0 && Math.random() < failRate) {
    return { ok: false, error: '수신자 미동의(모의 실패)' };
  }
  return { ok: true, ref: 'mock-at-' + randomToken(6) };
}

/** SMS/LMS 대체발송 */
async function sendSms({ phone, body }) {
  const channel = smsChannel(body);
  if (provider() === 'http') {
    const endpoint = process.env.STONEKIM_SMS_ENDPOINT;
    if (!endpoint) return { ok: false, error: 'SMS_ENDPOINT 미설정', channel };
    const res = await postJson(
      endpoint,
      { to: phone, from: process.env.STONEKIM_MSG_SENDER, type: channel, text: body },
      process.env.STONEKIM_MSG_API_KEY
    );
    return { ...res, channel };
  }
  if (!normalizePhone(phone)) return { ok: false, error: '휴대폰번호 형식 오류', channel };
  return { ok: true, ref: 'mock-sms-' + randomToken(6), channel };
}

/**
 * 알림톡 발송 후 실패 시 SMS/LMS 자동 대체발송.
 * 반환: { status, channel, ref, error }
 *   status: 'SENT'(알림톡 성공) | 'SENT_SMS'(대체발송 성공) | 'FAILED'
 */
async function deliver({ phone, body, messageType }) {
  let alim;
  try {
    alim = await sendAlimtalk({ phone, body, messageType });
  } catch (err) {
    alim = { ok: false, error: `알림톡 예외: ${err.message}` };
  }
  if (alim.ok) return { status: 'SENT', channel: 'ALIMTALK', ref: alim.ref, error: null };

  let sms;
  try {
    sms = await sendSms({ phone, body });
  } catch (err) {
    sms = { ok: false, error: `SMS 예외: ${err.message}`, channel: smsChannel(body) };
  }
  if (sms.ok) {
    return {
      status: 'SENT_SMS',
      channel: sms.channel,
      ref: sms.ref,
      error: `알림톡 실패(${alim.error}) → ${sms.channel} 대체발송`,
    };
  }
  return {
    status: 'FAILED',
    channel: 'ALIMTALK',
    ref: null,
    error: `알림톡 실패(${alim.error}) / 대체발송 실패(${sms.error})`,
  };
}

module.exports = { deliver, sendAlimtalk, sendSms, smsByteLength, smsChannel, provider };
