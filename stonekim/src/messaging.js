'use strict';
const crypto = require('node:crypto');
const { randomToken, normalizePhone } = require('./util');
const templates = require('./templates');

/**
 * 발송 채널 어댑터.
 *
 *   STONEKIM_MSG_PROVIDER = mock | solapi | http
 *
 * - mock   : 실제 발송 없이 성공 처리 (개발·시연 기본값)
 * - solapi : 솔라피(구 쿨에스엠에스) REST API. 알림톡(ATA) + SMS/LMS
 * - http   : 그 외 사업자용 범용 JSON 엔드포인트
 *
 * 알림톡 실패 시 SMS/LMS 대체발송은 사업자 자동 대체가 아니라 이 모듈이 직접 수행한다.
 * 어느 채널로 나갔는지 DB 에 정확히 남겨야 하기 때문이다(§5 발송 결과 기록).
 */

const SOLAPI_BASE = process.env.STONEKIM_SOLAPI_BASE || 'https://api.solapi.com';
const LMS_SUBJECT = process.env.STONEKIM_LMS_SUBJECT || '스톤킴 시공사진 리워드 안내';
const TIMEOUT_MS = Number(process.env.STONEKIM_MSG_TIMEOUT_MS || 15000);

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

/** 발신번호(사전 등록된 번호여야 한다) */
function sender() {
  return normalizePhone(process.env.STONEKIM_MSG_SENDER) || process.env.STONEKIM_MSG_SENDER || '';
}

/**
 * 솔라피 인증 헤더.
 * signature = HMAC-SHA256(date + salt, apiSecret)
 * Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...
 */
function solapiAuthHeader({ apiKey, apiSecret, date = new Date().toISOString(), salt = crypto.randomBytes(16).toString('hex') } = {}) {
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function solapiConfig() {
  return {
    apiKey: process.env.STONEKIM_SOLAPI_API_KEY || '',
    apiSecret: process.env.STONEKIM_SOLAPI_API_SECRET || '',
    pfId: process.env.STONEKIM_KAKAO_PFID || '',
    from: sender(),
  };
}

/** 설정이 비어 있으면 어떤 값이 빠졌는지 알려준다 (설정 화면·점검 스크립트용) */
function configIssues() {
  const mode = provider();
  const issues = [];
  if (mode === 'mock') return issues;
  if (!sender()) issues.push('발신번호(STONEKIM_MSG_SENDER)');
  if (mode === 'solapi') {
    const config = solapiConfig();
    if (!config.apiKey) issues.push('솔라피 API Key(STONEKIM_SOLAPI_API_KEY)');
    if (!config.apiSecret) issues.push('솔라피 API Secret(STONEKIM_SOLAPI_API_SECRET)');
    if (!config.pfId) issues.push('카카오 채널 ID(STONEKIM_KAKAO_PFID)');
    for (const [type, env] of [['1차', 'STONEKIM_TPL_FIRST'], ['2차', 'STONEKIM_TPL_SECOND'], ['최종', 'STONEKIM_TPL_FINAL']]) {
      if (!process.env[env]) issues.push(`${type} 알림톡 템플릿 코드(${env})`);
    }
  }
  if (mode === 'http') {
    if (!process.env.STONEKIM_ALIMTALK_ENDPOINT) issues.push('알림톡 엔드포인트(STONEKIM_ALIMTALK_ENDPOINT)');
    if (!process.env.STONEKIM_SMS_ENDPOINT) issues.push('문자 엔드포인트(STONEKIM_SMS_ENDPOINT)');
  }
  return issues;
}

function providerLabel() {
  const mode = provider();
  const name = { mock: '모의 발송 (mock · 실제 발송 없음)', solapi: '솔라피 알림톡/문자', http: 'HTTP 게이트웨이' }[mode] || mode;
  const issues = configIssues();
  return issues.length ? `${name} · 설정 누락: ${issues.join(', ')}` : name;
}

async function requestJson(url, { method = 'POST', headers = {}, payload } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON 이 아닐 수 있다 */ }
  return { res, json, text };
}

/** 솔라피 단건 발송 */
async function solapiSend({ to, text, type, kakaoOptions }) {
  const config = solapiConfig();
  if (!config.apiKey || !config.apiSecret) return { ok: false, error: '솔라피 API 키 미설정' };
  if (!config.from) return { ok: false, error: '발신번호 미설정' };

  const message = { to, from: config.from, text, type };
  if (type === 'LMS') message.subject = LMS_SUBJECT;
  if (kakaoOptions) message.kakaoOptions = kakaoOptions;

  const { res, json, text: raw } = await requestJson(`${SOLAPI_BASE}/messages/v4/send`, {
    headers: { Authorization: solapiAuthHeader(config) },
    payload: { message },
  });

  if (!res.ok) {
    const reason = (json && (json.errorMessage || json.message)) || raw.slice(0, 200) || `HTTP ${res.status}`;
    const code = (json && (json.errorCode || json.statusCode)) || res.status;
    return { ok: false, error: `${code} ${reason}` };
  }
  // 200 이어도 개별 메시지가 실패할 수 있다
  const failed = json && Array.isArray(json.failedMessageList) ? json.failedMessageList : [];
  if (failed.length) {
    const first = failed[0] || {};
    return { ok: false, error: `${first.statusCode || 'FAIL'} ${first.statusMessage || '발송 실패'}` };
  }
  const statusCode = json && (json.statusCode || (json.groupInfo && json.groupInfo.status));
  if (statusCode && String(statusCode) !== '2000' && String(statusCode).startsWith('4')) {
    return { ok: false, error: `${statusCode} ${(json && json.statusMessage) || '발송 실패'}` };
  }
  return { ok: true, ref: (json && (json.messageId || json.groupId)) || null };
}

/** 알림톡 1건 발송 시도 */
async function sendAlimtalk({ phone, body, messageType, variables }) {
  const mode = provider();

  if (mode === 'solapi') {
    const templateId = templates.templateCode(messageType);
    if (!templateId) return { ok: false, error: '승인된 알림톡 템플릿 코드 미설정' };
    return solapiSend({
      to: phone,
      text: body, // 알림톡 실패 시 솔라피 자동 대체는 끄고(disableSms) 직접 처리한다
      type: 'ATA',
      kakaoOptions: {
        pfId: solapiConfig().pfId,
        templateId,
        disableSms: true,
        variables: variables || {},
      },
    });
  }

  if (mode === 'http') {
    const endpoint = process.env.STONEKIM_ALIMTALK_ENDPOINT;
    if (!endpoint) return { ok: false, error: 'ALIMTALK_ENDPOINT 미설정' };
    const { res, json, text } = await requestJson(endpoint, {
      headers: process.env.STONEKIM_MSG_API_KEY ? { Authorization: `Bearer ${process.env.STONEKIM_MSG_API_KEY}` } : {},
      payload: {
        to: phone,
        from: sender(),
        senderKey: process.env.STONEKIM_ALIMTALK_SENDER_KEY,
        templateCode: templates.templateCode(messageType),
        text: body,
        variables: variables || {},
      },
    });
    if (!res.ok) {
      const reason = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
      return { ok: false, error: `${res.status} ${reason}` };
    }
    return { ok: true, ref: (json && (json.messageId || json.id || json.requestId)) || null };
  }

  // mock: 실제 발송 없이 성공 처리. 대체발송 경로 점검을 위해 실패율을 줄 수 있다.
  const failRate = Number(process.env.STONEKIM_MOCK_ALIMTALK_FAIL_RATE || 0);
  if (!normalizePhone(phone)) return { ok: false, error: '휴대폰번호 형식 오류' };
  if (failRate > 0 && Math.random() < failRate) return { ok: false, error: '수신자 미동의(모의 실패)' };
  return { ok: true, ref: 'mock-at-' + randomToken(6) };
}

/** SMS/LMS 대체발송 */
async function sendSms({ phone, body }) {
  const channel = smsChannel(body);
  const mode = provider();

  if (mode === 'solapi') {
    const result = await solapiSend({ to: phone, text: body, type: channel });
    return { ...result, channel };
  }

  if (mode === 'http') {
    const endpoint = process.env.STONEKIM_SMS_ENDPOINT;
    if (!endpoint) return { ok: false, error: 'SMS_ENDPOINT 미설정', channel };
    const { res, json, text } = await requestJson(endpoint, {
      headers: process.env.STONEKIM_MSG_API_KEY ? { Authorization: `Bearer ${process.env.STONEKIM_MSG_API_KEY}` } : {},
      payload: { to: phone, from: sender(), type: channel, subject: LMS_SUBJECT, text: body },
    });
    if (!res.ok) {
      const reason = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
      return { ok: false, error: `${res.status} ${reason}`, channel };
    }
    return { ok: true, ref: (json && (json.messageId || json.id || json.requestId)) || null, channel };
  }

  if (!normalizePhone(phone)) return { ok: false, error: '휴대폰번호 형식 오류', channel };
  return { ok: true, ref: 'mock-sms-' + randomToken(6), channel };
}

/**
 * 알림톡 발송 후 실패 시 SMS/LMS 자동 대체발송.
 * 반환: { status, channel, ref, error }
 *   status: 'SENT'(알림톡 성공) | 'SENT_SMS'(대체발송 성공) | 'FAILED'
 */
async function deliver({ phone, body, messageType, variables }) {
  let alim;
  try {
    alim = await sendAlimtalk({ phone, body, messageType, variables });
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

module.exports = {
  deliver,
  sendAlimtalk,
  sendSms,
  smsByteLength,
  smsChannel,
  provider,
  providerLabel,
  configIssues,
  sender,
  solapiAuthHeader,
  solapiConfig,
};
