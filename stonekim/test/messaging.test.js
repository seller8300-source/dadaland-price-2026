'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeHttp = require('node:http');
const { useTempData } = require('./helper');
useTempData('messaging');

// 가짜 솔라피 서버를 띄우고 그 주소를 바라보게 한다 (실제 API 키 없이 요청 형식 검증)
let server;
let received = [];
let respond = () => ({ status: 200, body: { messageId: 'MSG-1', statusCode: '2000' } });

process.env.STONEKIM_SOLAPI_BASE = 'http://127.0.0.1:0';

test.before(async () => {
  server = nodeHttp.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      const answer = respond(received[received.length - 1]);
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.STONEKIM_SOLAPI_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.STONEKIM_MSG_PROVIDER = 'solapi';
  process.env.STONEKIM_SOLAPI_API_KEY = 'TESTKEY';
  process.env.STONEKIM_SOLAPI_API_SECRET = 'TESTSECRET';
  process.env.STONEKIM_KAKAO_PFID = 'KA01PF000000000000000000000000000';
  process.env.STONEKIM_MSG_SENDER = '025550000';
  process.env.STONEKIM_TPL_FIRST = 'KA01TP000000000000000000000000001';
  process.env.STONEKIM_TPL_SECOND = 'KA01TP000000000000000000000000002';
  process.env.STONEKIM_TPL_FINAL = 'KA01TP000000000000000000000000003';
});

test.after(() => server.close());

test.beforeEach(() => { received = []; });

const messaging = () => require('../src/messaging');

test('솔라피 인증 헤더는 HMAC-SHA256(date+salt, secret) 서명을 담는다', () => {
  const crypto = require('node:crypto');
  const header = messaging().solapiAuthHeader({
    apiKey: 'KEY', apiSecret: 'SECRET', date: '2019-07-01T00:41:48Z', salt: 'jqsba2jxjnrjor',
  });
  const expected = crypto.createHmac('sha256', 'SECRET').update('2019-07-01T00:41:48Zjqsba2jxjnrjor').digest('hex');
  assert.match(header, /^HMAC-SHA256 apiKey=KEY, date=2019-07-01T00:41:48Z, salt=jqsba2jxjnrjor, signature=[0-9a-f]{64}$/);
  assert.ok(header.endsWith(expected));
});

test('알림톡은 ATA 타입과 kakaoOptions 로 전송된다', async () => {
  respond = () => ({ status: 200, body: { messageId: 'MSG-OK', statusCode: '2000' } });
  const result = await messaging().deliver({
    phone: '01012345678',
    body: '테스트 본문',
    messageType: 'FIRST',
    variables: { '#{고객명}': '김고객', '#{링크}': 'https://x/y' },
  });

  assert.equal(result.status, 'SENT');
  assert.equal(result.channel, 'ALIMTALK');
  assert.equal(result.ref, 'MSG-OK');
  assert.equal(received.length, 1);

  const sent = received[0];
  assert.equal(sent.url, '/messages/v4/send');
  assert.match(sent.auth, /^HMAC-SHA256 apiKey=TESTKEY, date=.+, salt=.+, signature=[0-9a-f]{64}$/);
  assert.equal(sent.body.message.type, 'ATA');
  assert.equal(sent.body.message.to, '01012345678');
  assert.equal(sent.body.message.from, '025550000');
  assert.equal(sent.body.message.kakaoOptions.pfId, process.env.STONEKIM_KAKAO_PFID);
  assert.equal(sent.body.message.kakaoOptions.templateId, process.env.STONEKIM_TPL_FIRST);
  assert.equal(sent.body.message.kakaoOptions.disableSms, true, '대체발송은 직접 처리하므로 사업자 자동 대체는 끈다');
  assert.equal(sent.body.message.kakaoOptions.variables['#{고객명}'], '김고객');
});

test('알림톡 실패(4xx)면 LMS 로 대체발송하고 사유를 남긴다', async () => {
  respond = (request) =>
    request.body.message.type === 'ATA'
      ? { status: 400, body: { errorCode: 'InvalidKakaoTemplate', errorMessage: '템플릿 검수 미승인' } }
      : { status: 200, body: { messageId: 'MSG-SMS', statusCode: '2000' } };

  const longBody = '스톤킴 시공사진 리워드 안내입니다. '.repeat(5);
  const result = await messaging().deliver({ phone: '01012345678', body: longBody, messageType: 'FIRST' });

  assert.equal(result.status, 'SENT_SMS');
  assert.equal(result.channel, 'LMS');
  assert.equal(result.ref, 'MSG-SMS');
  assert.match(result.error, /InvalidKakaoTemplate/);
  assert.match(result.error, /템플릿 검수 미승인/);
  assert.equal(received.length, 2);
  assert.equal(received[1].body.message.type, 'LMS');
  assert.ok(received[1].body.message.subject, 'LMS 는 제목이 필요하다');
});

test('짧은 본문은 SMS 로 대체발송된다', async () => {
  respond = (request) =>
    request.body.message.type === 'ATA'
      ? { status: 400, body: { errorMessage: '수신거부' } }
      : { status: 200, body: { messageId: 'MSG-SMS2' } };
  const result = await messaging().deliver({ phone: '01012345678', body: '스톤킴 안내', messageType: 'FIRST' });
  assert.equal(result.channel, 'SMS');
  assert.equal(received[1].body.message.type, 'SMS');
});

test('200 응답이어도 failedMessageList 가 있으면 실패로 처리한다', async () => {
  respond = () => ({
    status: 200,
    body: { failedMessageList: [{ statusCode: '3049', statusMessage: '잘못된 수신번호' }] },
  });
  const result = await messaging().deliver({ phone: '01012345678', body: '본문', messageType: 'FIRST' });
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /3049/);
  assert.match(result.error, /잘못된 수신번호/);
});

test('설정 누락은 사전에 잡아낸다', () => {
  const saved = process.env.STONEKIM_KAKAO_PFID;
  delete process.env.STONEKIM_KAKAO_PFID;
  const issues = messaging().configIssues();
  assert.ok(issues.some((text) => text.includes('카카오 채널 ID')));
  assert.match(messaging().providerLabel(), /설정 누락/);
  process.env.STONEKIM_KAKAO_PFID = saved;
  assert.equal(messaging().configIssues().length, 0);
});

test('알림톡 템플릿 코드가 없으면 발송을 시도하지 않고 대체발송한다', async () => {
  const saved = process.env.STONEKIM_TPL_FIRST;
  delete process.env.STONEKIM_TPL_FIRST;
  respond = () => ({ status: 200, body: { messageId: 'MSG-SMS3' } });
  const result = await messaging().deliver({ phone: '01012345678', body: '본문', messageType: 'FIRST' });
  assert.equal(result.status, 'SENT_SMS');
  assert.equal(received.length, 1, '알림톡 요청 없이 바로 문자로 나간다');
  assert.match(result.error, /템플릿 코드 미설정/);
  process.env.STONEKIM_TPL_FIRST = saved;
});
