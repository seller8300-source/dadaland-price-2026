'use strict';
/**
 * 직원이 쓰던 출고 엑셀을 그대로 넣어도 읽히는지 미리 점검한다.
 * DB 를 전혀 건드리지 않으므로 운영 중에도 안전하게 실행할 수 있다.
 *
 *   node scripts/check-excel.js "C:\\출고내역\\2026-09 출고.xlsx"
 */
const fs = require('node:fs');
const path = require('node:path');
const importer = require('../src/import');
const { formatPhone } = require('../src/util');

const FIELD_LABEL = {
  order_number: '주문번호', ship_date: '출고일', customer_name: '고객명', phone: '휴대폰번호',
  product: '제품명', quantity: '수량', site_name: '현장명', region: '현장지역',
  installation_date: '시공예정일', sales_manager: '담당자',
};
const REQUIRED = ['order_number', 'ship_date', 'customer_name', 'phone'];

const file = process.argv[2];
if (!file) {
  console.error('사용법: node scripts/check-excel.js <엑셀 또는 CSV 경로>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`파일을 찾을 수 없습니다: ${file}`);
  process.exit(1);
}

let result;
try {
  result = importer.parseUpload(fs.readFileSync(file), path.basename(file), { checkExisting: false });
} catch (err) {
  console.error(`읽기 실패: ${err.message}`);
  console.error('첫 행에 주문번호 / 출고일 / 고객명 / 휴대폰번호 항목이 있는지 확인해 주세요.');
  process.exit(2);
}

const { rows, summary, headerMap, missingColumns } = result;

console.log(`\n■ 파일: ${path.basename(file)}`);
console.log('\n■ 컬럼 인식 결과');
for (const [field, label] of Object.entries(FIELD_LABEL)) {
  const index = headerMap[field];
  const mark = index === undefined ? (REQUIRED.includes(field) ? '✗ 필수인데 못 찾음' : '· 없음(선택)') : `✓ ${index + 1}번째 열`;
  console.log(`  ${label.padEnd(8, ' ')} ${mark}`);
}
if (missingColumns.some((field) => REQUIRED.includes(field))) {
  console.log('\n  ※ 필수 컬럼을 못 찾았습니다. 헤더 이름을 바꾸거나 src/import.js 의 HEADER_ALIASES 에 회사 표기를 추가하면 됩니다.');
}

console.log('\n■ 검증 요약');
console.log(`  총 ${summary.total}건 / 정상 ${summary.valid}건 / 전화번호 오류 ${summary.bad_phone}건 / 중복 ${summary.duplicate}건 / 기타 오류 ${summary.other}건`);
console.log('  (이미 등록된 주문번호와의 중복은 실제 업로드 화면에서 한 번 더 확인합니다.)');

const problems = rows.filter((row) => !row.valid || row.warnings.length).slice(0, 30);
if (problems.length) {
  console.log('\n■ 확인이 필요한 행 (최대 30건)');
  for (const row of problems) {
    const notes = [...row.errors, ...row.warnings].map((item) => item.text).join(', ');
    console.log(`  ${String(row.line).padStart(4, ' ')}행  ${row.order_number || '(주문번호없음)'} / ${row.customer_name || '-'} / ${row.phone_raw || '-'}  → ${notes}`);
  }
}

const samples = rows.filter((row) => row.valid).slice(0, 3);
if (samples.length) {
  console.log('\n■ 정상 인식 예시');
  for (const row of samples) {
    console.log(`  ${row.order_number} | ${row.customer_name} | ${formatPhone(row.phone)} | 출고 ${row.ship_date} | 시공예정 ${row.installation_date || '미정'} | ${row.product || '-'}`);
  }
}
console.log('');
