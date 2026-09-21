'use strict';
/**
 * 발송 설정 점검 + 실제 1건 테스트 발송.
 *
 *   node scripts/check-provider.js                       설정만 점검 (발송 안 함)
 *   node scripts/check-provider.js 010-1234-5678         문구 미리보기 (발송 안 함)
 *   node scripts/check-provider.js 010-1234-5678 --send  실제 발송 (관리자 본인 번호로만)
 *   node scripts/check-provider.js 010-1234-5678 --send --type=SECOND
 */
const messaging = require('../src/messaging');
const templates = require('../src/templates');
const rewardTiers = require('../src/reward');
const scheduler = require('../src/scheduler');
const { normalizePhone, formatPhone } = require('../src/util');

const args = process.argv.slice(2);
const phoneArg = args.find((arg) => !arg.startsWith('--'));
const doSend = args.includes('--send');
const typeArg = (args.find((arg) => arg.startsWith('--type=')) || '--type=FIRST').split('=')[1].toUpperCase();
const messageType = ['FIRST', 'SECOND', 'FINAL'].includes(typeArg) ? typeArg : 'FIRST';

(async () => {
  const issues = messaging.configIssues();
  console.log('\n■ 발송 설정');
  console.log(`  채널        : ${messaging.provider()}`);
  console.log(`  발신번호    : ${messaging.sender() ? formatPhone(messaging.sender()) : '(미설정)'}`);
  console.log(`  업로드 주소 : ${scheduler.baseUrl()}`);
  console.log(`  템플릿 코드 : ${templates.templateCode(messageType) || '(미설정)'} (${messageType})`);
  if (issues.length) {
    console.log('\n  ✗ 설정 누락:');
    for (const issue of issues) console.log(`     - ${issue}`);
  } else {
    console.log('\n  ✓ 필수 설정이 모두 채워져 있습니다.');
  }
  if (messaging.provider() === 'mock') {
    console.log('  ※ 현재 mock 모드라 실제 카카오톡/문자는 나가지 않습니다. (STONEKIM_MSG_PROVIDER=solapi 로 전환)');
  }

  const tiers = rewardTiers.current();
  const sampleUrl = `${scheduler.baseUrl()}/project/upload/SAMPLE-TOKEN`;
  const body = templates.buildBody(messageType, sampleUrl, tiers);
  console.log(`\n■ ${messageType} 메시지 본문 (${messaging.smsByteLength(body)}바이트 · 대체발송 시 ${messaging.smsChannel(body)})`);
  console.log('┌────────────────────────────────────────');
  for (const line of body.split('\n')) console.log('│ ' + line);
  console.log('└────────────────────────────────────────');

  if (!phoneArg) {
    console.log('\n번호를 넣으면 발송 미리보기를, --send 를 붙이면 실제 발송합니다.\n');
    return;
  }
  const phone = normalizePhone(phoneArg);
  if (!phone) {
    console.error(`\n휴대폰번호 형식이 올바르지 않습니다: ${phoneArg}\n`);
    process.exit(1);
  }
  if (!doSend) {
    console.log(`\n수신 예정: ${formatPhone(phone)} · 실제 발송하려면 --send 를 붙이세요.\n`);
    return;
  }

  console.log(`\n발송 중... → ${formatPhone(phone)}`);
  const result = await messaging.deliver({
    phone,
    body,
    messageType,
    variables: {
      '#{고객명}': '테스트',
      '#{토큰}': 'SAMPLE-TOKEN',
      '#{링크}': sampleUrl,
      '#{기본리워드}': tiers.baseWords,
      '#{최대리워드}': tiers.maxWords,
    },
  });
  console.log(`  상태   : ${result.status}`);
  console.log(`  채널   : ${result.channel}`);
  console.log(`  식별자 : ${result.ref || '-'}`);
  if (result.error) console.log(`  비고   : ${result.error}`);
  console.log('');
  process.exit(result.status === 'FAILED' ? 1 : 0);
})();
