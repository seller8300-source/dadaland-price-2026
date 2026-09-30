'use strict';
const { escapeHtml, fmtDate, fmtDateTime, formatPhone, maskPhone, won } = require('../util');

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --brand:#FC5400;--brand-dark:#D94500;--brand-tint:#FFF2EB;--brand-line:#FBD7C2;
  --ink:#141414;--ink-2:#3C4043;--muted:#74797E;--line:#E7E7E4;--bg:#F5F5F3;--card:#fff;--dark:#0C0C0C;
  --ok:#137A45;--ok-bg:#E4F3EB;--warn:#B25000;--warn-bg:#FDF0E2;--err:#C0392B;--err-bg:#FCE9E6;
  --info:#1F5B87;--info-bg:#E7F0F7;
  --shadow:0 1px 2px rgba(20,20,20,.04),0 6px 18px -8px rgba(20,20,20,.10);
  --radius:12px}
body{font-family:"Wanted Sans Variable","Wanted Sans","Pretendard Variable",Pretendard,
  -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Tossface",sans-serif;
  background:var(--bg);color:var(--ink);font-size:14px;line-height:1.6;word-break:keep-all;
  letter-spacing:-.015em;-webkit-text-size-adjust:100%;font-feature-settings:"ss01"}
a{color:inherit;text-decoration:none}

/* ------- 상단바: 고객 화면과 같은 검정 + 주황 포인트 ------- */
.top{background:var(--dark);border-bottom:3px solid var(--brand);position:sticky;top:0;z-index:20}
.top-in{max-width:1240px;margin:0 auto;padding:0 20px;display:flex;align-items:center;gap:20px;height:60px}
.logo{font-weight:900;letter-spacing:.14em;font-size:15px;color:var(--brand);font-style:italic;flex:none}
nav{display:flex;gap:3px;flex:1;overflow-x:auto;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{padding:8px 13px;border-radius:99px;font-size:13.5px;font-weight:500;color:#A7ACAF;white-space:nowrap;
  transition:background .12s,color .12s}
nav a:hover{background:rgba(255,255,255,.09);color:#fff}
nav a.on{background:var(--brand);color:#fff;font-weight:700}
.who{font-size:12.5px;color:#9BA0A4;display:flex;gap:10px;align-items:center;white-space:nowrap;flex:none}
.who span{color:#E8E8E6;font-weight:600}
.who .btn{background:transparent;border-color:#393D40;color:#C9CDD0}
.who .btn:hover{background:rgba(255,255,255,.08);opacity:1}

.wrap{max-width:1240px;margin:0 auto;padding:26px 20px 72px}
h1.page{font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px}
.page-sub{color:var(--muted);font-size:13.5px;margin-bottom:22px}

/* ------- 지표 타일 ------- */
.grid{display:grid;gap:12px}
.g4{grid-template-columns:repeat(4,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
@media(max-width:860px){.g4,.g3,.g2{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.g4,.g3,.g2{grid-template-columns:1fr}}
.tile{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:17px 18px;
  box-shadow:var(--shadow)}
.tile .k{font-size:12.5px;color:var(--muted);font-weight:600}
.tile .v{font-size:30px;font-weight:800;margin-top:4px;letter-spacing:-.045em;line-height:1.15}
.tile .v small{font-size:13px;font-weight:500;color:var(--muted);margin-left:5px;letter-spacing:-.02em}
.tile.hi{background:var(--brand);border-color:var(--brand);color:#fff;
  box-shadow:0 2px 6px rgba(252,84,0,.22),0 10px 24px -10px rgba(252,84,0,.5)}
.tile.hi .k{color:#FFD9C6}
.tile.hi .v small{color:#FFD9C6}

/* ------- 카드 ------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;
  margin-bottom:16px;box-shadow:var(--shadow)}
.card h2{font-size:15.5px;font-weight:700;letter-spacing:-.025em;margin-bottom:14px;
  display:flex;justify-content:space-between;align-items:center;gap:10px}
.card h2 .sub{font-size:12.5px;color:var(--muted);font-weight:500;letter-spacing:-.01em}

/* ------- 표 ------- */
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:12px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:700;background:#FAFAF8;white-space:nowrap;
  letter-spacing:0;text-transform:none}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background .1s}
tbody tr:hover{background:var(--brand-tint)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.tablewrap{overflow-x:auto;border-radius:var(--radius)}

/* ------- 배지 ------- */
.badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:700;white-space:nowrap;
  letter-spacing:-.01em}
.b-gray{background:#EFEFEC;color:#5F6468}
.b-blue{background:var(--info-bg);color:var(--info)}
.b-green{background:var(--ok-bg);color:var(--ok)}
.b-amber{background:var(--warn-bg);color:var(--warn)}
.b-red{background:var(--err-bg);color:var(--err)}

.filters{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
.filters a{padding:7px 14px;border:1px solid var(--line);border-radius:99px;background:#fff;font-size:12.5px;
  font-weight:600;color:var(--muted)}
.filters a:hover{border-color:var(--brand);color:var(--brand)}
.filters a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
form.inline{display:inline}

/* ------- 입력 ------- */
input[type=text],input[type=password],input[type=search],input[type=number],input[type=date],select,textarea{
  padding:11px 13px;border:1px solid var(--line);border-radius:9px;font-family:inherit;font-size:14px;
  background:#fff;color:var(--ink);outline:none;max-width:100%;transition:border-color .12s,box-shadow .12s;
  letter-spacing:-.015em}
input::placeholder,textarea::placeholder{color:#B4B8BB}
input:focus,select:focus,textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(252,84,0,.13)}
input[type=file]{font-family:inherit;font-size:13.5px}
select{appearance:none;padding-right:34px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8'><path d='M1 1l5 5 5-5' stroke='%2374797E' stroke-width='1.8' fill='none' stroke-linecap='round'/></svg>");
  background-repeat:no-repeat;background-position:right 13px center}
textarea{width:100%;min-height:84px;line-height:1.65;resize:vertical}

/* ------- 버튼 ------- */
.btn{display:inline-block;padding:11px 17px;border:1px solid var(--brand);border-radius:9px;background:var(--brand);
  color:#fff;font-family:inherit;font-size:13.8px;font-weight:700;cursor:pointer;letter-spacing:-.02em;
  transition:background .12s,border-color .12s,opacity .12s;line-height:1.35}
.btn:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
.btn.ghost{background:#fff;color:var(--brand)}
.btn.ghost:hover{background:var(--brand-tint)}
.btn.sm{padding:7px 12px;font-size:12.5px;border-radius:8px}
.btn.danger{background:var(--err);border-color:var(--err);color:#fff}
.btn.danger:hover{background:#A32E22;border-color:#A32E22}
.btn.quiet{background:#fff;color:var(--muted);border-color:var(--line);font-weight:600}
.btn.quiet:hover{background:var(--bg);color:var(--ink);border-color:#D3D3CF}
.btn:disabled{opacity:.42;cursor:not-allowed}
.btn:disabled:hover{background:var(--brand);border-color:var(--brand)}

.row{display:flex;gap:11px;flex-wrap:wrap;align-items:center}
.field{margin-bottom:15px}
.field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--ink-2)}
.field .hint{font-size:12.3px;color:var(--muted);margin-top:5px;line-height:1.55}
.hint{font-size:12.3px;color:var(--muted);line-height:1.55}

/* ------- 알림 ------- */
.flash{padding:13px 16px;border-radius:10px;margin-bottom:16px;font-size:13.5px;font-weight:500;
  border:1px solid transparent}
.flash.ok{background:var(--ok-bg);color:var(--ok);border-color:#C2E3D1}
.flash.err{background:var(--err-bg);color:var(--err);border-color:#F3CFC9}
.flash.info{background:var(--info-bg);color:var(--info);border-color:#C9DDEC}

.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:13px}
.photo{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#fff;box-shadow:var(--shadow)}
.photo .img{position:relative;padding-top:72%;background:#EDEDEA}
.photo .img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo .img .tag{position:absolute;top:8px;left:8px}
.photo .acts{display:flex;gap:5px;padding:9px}
.photo .acts button{flex:1;padding:7px 2px;font-size:11.8px;border:1px solid var(--line);border-radius:7px;
  background:#fff;cursor:pointer;font-family:inherit;font-weight:600;color:var(--muted)}
.photo .acts button:hover{border-color:var(--brand);color:var(--brand)}
.photo .acts button.on{background:var(--brand);color:#fff;border-color:var(--brand)}

.kv{display:grid;grid-template-columns:118px 1fr;gap:9px 14px;font-size:13.5px}
.kv dt,.kv>div:nth-child(odd){color:var(--muted);font-weight:600}

.login{max-width:380px;margin:11vh auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:32px;
  box-shadow:0 4px 12px rgba(20,20,20,.05),0 20px 48px -20px rgba(20,20,20,.22)}
.login .logo{margin-bottom:22px;color:var(--brand);font-style:italic;font-weight:900;letter-spacing:.14em;font-size:17px}
.login input{width:100%}
.login .btn{width:100%;padding:13px;font-size:15px}

.muted{color:var(--muted)}
.small{font-size:12.3px}
.right{text-align:right}
.pager{display:flex;gap:6px;justify-content:center;margin-top:20px;flex-wrap:wrap}
.pager a,.pager span{padding:7px 13px;border:1px solid var(--line);border-radius:8px;background:#fff;
  font-size:12.5px;font-weight:600;color:var(--muted)}
.pager a:hover{border-color:var(--brand);color:var(--brand)}
.pager span.on{background:var(--brand);color:#fff;border-color:var(--brand)}
details.more{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  margin-bottom:16px;box-shadow:var(--shadow)}
details.more>summary{padding:15px 20px;font-size:14px;font-weight:700;cursor:pointer;list-style:none;
  display:flex;align-items:center;gap:8px;color:var(--ink-2);letter-spacing:-.025em}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:'▸';color:var(--brand);font-size:12px;transition:transform .15s}
details.more[open]>summary::before{transform:rotate(90deg)}
details.more>summary:hover{color:var(--brand)}
details.more>.grid{padding:0 20px 20px}
details.more[open]>summary{border-bottom:1px solid var(--line);margin-bottom:16px}
.todo{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  background:var(--brand-tint);border:1px solid var(--brand-line);border-radius:var(--radius);
  padding:15px 18px;margin-bottom:18px;font-size:14.5px;font-weight:600;color:#8A3400}
.todo b{color:var(--brand);font-weight:800}
.bar{height:8px;border-radius:99px;background:#EAEAE7;overflow:hidden;margin-top:8px}
.bar i{display:block;height:100%;background:var(--brand);border-radius:99px}
@media(max-width:700px){
  .top-in{height:auto;padding:10px 14px;flex-wrap:wrap;gap:10px}
  nav{order:3;width:100%;flex:1 0 100%;padding-bottom:2px}
  .who{margin-left:auto}
  .wrap{padding:20px 14px 60px}
  h1.page{font-size:21px}
  .card{padding:16px}
}
`;

const NAV = [
  ['/admin', '📊 대시보드'],
  ['/admin/projects', '🏗 주문·현장'],
  ['/admin/review', '📷 사진 검수'],
  ['/admin/rewards', '🎁 리워드'],
  ['/admin/messages', '💬 발송 로그'],
  ['/admin/import', '📥 엑셀 업로드'],
  ['/admin/settings', '⚙️ 설정', 'OWNER'],
  ['/admin/users', '👥 계정 관리', 'OWNER'],
];

/** 발송 허용 번호가 설정되어 있으면 모든 관리자 화면 상단에 표시한다 */
function safetyBanner() {
  const scheduler = require('../scheduler');
  const allowed = scheduler.allowlist();
  if (!allowed.length) return '';
  return `<div class="flash err" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <span><b>테스트 모드</b> · 허용된 번호(${allowed.map((phone) => escapeHtml(formatPhone(phone))).join(', ')})로만 발송됩니다. 다른 고객에게는 한 건도 나가지 않습니다.</span>
    <a href="/admin/settings" style="text-decoration:underline">설정에서 해제</a>
  </div>`;
}

function layout({ title, active, session, content, flash }) {
  const isOwner = !session || session.role === 'OWNER';
  const nav = NAV.filter(([, , need]) => !need || isOwner).map(
    ([href, label]) =>
      `<a href="${href}" class="${active === href ? 'on' : ''}">${escapeHtml(label)}</a>`
  ).join('');
  const flashHtml = flash
    ? `<div class="flash ${escapeHtml(flash.type || 'info')}">${escapeHtml(flash.message)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://static.toss.im" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/complete/WantedSansVariable.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<link rel="stylesheet" href="https://static.toss.im/tps/main.css">
<title>${escapeHtml(title)} · STONEKIM 관리자</title>
<style>${CSS}</style>
</head><body>
<div class="top"><div class="top-in">
  <div class="logo">STONEKIM</div>
  <nav>${nav}</nav>
  <div class="who">
    <span>${escapeHtml(session.display_name || session.username)}</span>
    <form method="post" action="/admin/logout" class="inline">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <button class="btn quiet sm" type="submit">로그아웃</button>
    </form>
  </div>
</div></div>
<div class="wrap">${safetyBanner()}${flashHtml}${content}</div>
</body></html>`;
}

function loginPage({ error, notice }) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://static.toss.im" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/complete/WantedSansVariable.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<link rel="stylesheet" href="https://static.toss.im/tps/main.css">
<title>관리자 로그인 · STONEKIM</title><style>${CSS}</style></head>
<body><div class="login">
  <div class="logo">STONEKIM</div>
  <h1 class="page" style="font-size:17px">시공사진 수집 관리자</h1>
  <div class="page-sub">인증된 담당자만 접근할 수 있습니다.</div>
  ${notice ? `<div class="flash info">${escapeHtml(notice)}</div>` : ''}
  ${error ? `<div class="flash err">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/admin/login">
    <div class="field"><label>아이디</label><input type="text" name="username" autocomplete="username" autofocus></div>
    <div class="field"><label>비밀번호</label><input type="password" name="password" autocomplete="current-password"></div>
    <button class="btn" style="width:100%" type="submit">로그인</button>
  </form>
</div></body></html>`;
}

const STATUS_BADGE = {
  READY: ['발송예정', 'b-gray'],
  SENT_1: ['1차 발송', 'b-blue'],
  SENT_2: ['2차 발송', 'b-amber'],
  SENT_FINAL: ['최종 발송', 'b-amber'],
  PHOTO_SUBMITTED: ['사진등록', 'b-green'],
};

const MESSAGE_STATUS_BADGE = {
  SCHEDULED: ['예약', 'b-gray'],
  SENT: ['발송완료', 'b-green'],
  SENT_SMS: ['SMS 대체', 'b-amber'],
  FAILED: ['발송실패', 'b-red'],
  CANCELED_PHOTO: ['사진등록 취소', 'b-blue'],
  CANCELED_ADMIN: ['관리자 중단', 'b-gray'],
};

const REWARD_BADGE = {
  PENDING: ['검토대기', 'b-amber'],
  SCHEDULED: ['지급예정', 'b-blue'],
  PAID: ['지급완료', 'b-green'],
  EXCLUDED: ['지급제외', 'b-gray'],
};

const TYPE_LABEL = { FIRST: '1차', SECOND: '2차', FINAL: '최종', TEST: '테스트', MANUAL: '수동' };

function badge(map, key, fallback = ['-', 'b-gray']) {
  const [label, cls] = map[key] || fallback;
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function dashboardPage({ stats, kpi, session, flash, recent }) {
  const tile = (k, v, extra = '', hi = false) =>
    `<div class="tile${hi ? ' hi' : ''}"><div class="k">${escapeHtml(k)}</div><div class="v">${v}${extra}</div></div>`;

  const recentRows = recent
    .map(
      (r) => `<tr>
      <td><a href="/admin/projects/${r.project_id}"><b>${escapeHtml(r.order_number)}</b></a></td>
      <td>${escapeHtml(r.customer_name)}</td>
      <td>${escapeHtml(r.site_name || '-')}</td>
      <td>${fmtDateTime(r.photo_submitted_at)}</td>
      <td class="num">${r.photo_count}장</td>
      <td>${badge(REWARD_BADGE, r.reward_status || 'PENDING')}</td>
    </tr>`
    )
    .join('');

  const content = `
<h1 class="page">대시보드</h1>
<div class="page-sub">${escapeHtml(stats.month)} 현황 · 가장 중요한 지표는 <b>시공사진 등록률</b>입니다.</div>

${
  stats.pending_review
    ? `<div class="todo"><span>📷 검수를 기다리는 사진이 <b>${stats.pending_review}건</b> 있습니다.</span>
         <a class="btn sm" href="/admin/review">사진 검수하러 가기</a></div>`
    : ''
}
<div class="grid g4" style="margin-bottom:12px">
  ${tile('총 출고 현장', stats.shipped)}
  ${tile('메시지 발송 대상', stats.targeted)}
  ${tile('사진 등록 현장', stats.photo_projects)}
  ${tile('사진 등록률', pct(stats.photo_rate), '', true)}
</div>
<details class="more">
  <summary>이번 달 발송·리워드 자세히 보기</summary>
  <div class="grid g4" style="margin-bottom:12px">
    ${tile('1차 발송', stats.sent_first)}
    ${tile('2차 발송', stats.sent_second)}
    ${tile('최종 발송', stats.sent_final)}
    ${tile('예약 대기', stats.scheduled_ahead)}
  </div>
  <div class="grid g4">
    ${tile('홍보 활용 승인', stats.usable_projects, ' <small>현장</small>')}
    ${tile('리워드 검토대기', stats.pending_review)}
    ${tile('리워드 지급 완료', stats.reward_paid_count, ' <small>건</small>')}
    ${tile('리워드 지급액', won(stats.reward_paid_amount).replace('원', ''), ' <small>원</small>')}
  </div>
</details>

<details class="more">
  <summary>MVP 성공 기준 지표 (누적)</summary>
  <div class="grid g4">
    ${tile('메시지 발송 수', kpi.messages_total)}
    ${tile('알림톡 성공률', pct(kpi.alimtalk_rate))}
    ${tile('업로드 페이지 방문률', pct(kpi.visit_rate))}
    ${tile('사진 등록률', pct(kpi.submit_rate), ` <small>${kpi.submitted}/${kpi.reached}</small>`)}
  </div>
  <div class="grid g4" style="margin-top:12px">
    ${tile('1차 메시지 등록', kpi.stage.FIRST)}
    ${tile('2차 추가 등록', kpi.stage.SECOND)}
    ${tile('최종 추가 등록', kpi.stage.FINAL)}
    ${tile('평균 등록 사진', kpi.avg_photos.toFixed(1), ' <small>장</small>')}
  </div>
  <div class="grid g4" style="margin-top:12px">
    ${tile('홍보 활용 가능 사진', pct(kpi.usable_ratio))}
    ${tile('BEST 컷', kpi.best_count)}
    ${tile('SMS 대체발송', kpi.sms_fallback)}
    ${tile('현장당 평균 리워드', won(Math.round(kpi.reward_avg)))}
  </div>
</details>

<div class="card">
  <h2>최근 사진 등록 <span class="sub"><a href="/admin/review">사진 검수로 이동 →</a></span></h2>
  <div class="tablewrap"><table>
    <thead><tr><th>주문</th><th>고객</th><th>현장</th><th>등록일시</th><th class="num">사진</th><th>리워드</th></tr></thead>
    <tbody>${recentRows || '<tr><td colspan="6" class="muted">아직 등록된 사진이 없습니다.</td></tr>'}</tbody>
  </table></div>
</div>`;
  return layout({ title: '대시보드', active: '/admin', session, content, flash });
}

const FILTERS = [
  ['all', '전체'],
  ['scheduled', '발송예정'],
  ['sent1', '1차 발송'],
  ['sent2', '2차 발송'],
  ['sentfinal', '최종 발송'],
  ['photo', '사진등록'],
  ['reward_review', '리워드 검토'],
  ['reward_done', '리워드 완료'],
  ['excluded', '발송제외'],
];

function projectsPage({ rows, filter, query, page, pages, total, session, flash }) {
  const filterLinks = FILTERS.map(
    ([key, label]) =>
      `<a class="${filter === key ? 'on' : ''}" href="/admin/projects?filter=${key}${
        query ? `&q=${encodeURIComponent(query)}` : ''
      }">${escapeHtml(label)}</a>`
  ).join('');

  const body = rows
    .map(
      (r) => `<tr>
    <td><a href="/admin/projects/${r.project_id}"><b>${escapeHtml(r.order_number)}</b></a>${
        r.message_excluded ? ' <span class="badge b-red">제외</span>' : ''
      }</td>
    <td>${escapeHtml(r.customer_name)}<div class="small muted">${escapeHtml(maskPhone(r.phone))}</div></td>
    <td>${escapeHtml(r.product || '-')}<div class="small muted">${escapeHtml(r.site_name || '')}</div></td>
    <td>${fmtDate(r.ship_date)}</td>
    <td>${r.installation_date ? fmtDate(r.installation_date) : '<span class="muted">미정</span>'}</td>
    <td>${badge(STATUS_BADGE, r.status)}${
        r.next_scheduled_at
          ? `<div class="small muted">${TYPE_LABEL[r.next_type] || ''} 예약 ${fmtDateTime(r.next_scheduled_at)}</div>`
          : ''
      }</td>
    <td>${r.photo_count ? `${r.photo_count}장` : '<span class="muted">미등록</span>'}</td>
    <td>${r.reward_status ? badge(REWARD_BADGE, r.reward_status) : '<span class="muted">-</span>'}</td>
  </tr>`
    )
    .join('');

  const pager = [];
  for (let p = 1; p <= pages; p++) {
    if (pages > 9 && Math.abs(p - page) > 3 && p !== 1 && p !== pages) continue;
    pager.push(
      p === page
        ? `<span class="on">${p}</span>`
        : `<a href="/admin/projects?filter=${filter}&q=${encodeURIComponent(query || '')}&page=${p}">${p}</a>`
    );
  }

  const content = `
<h1 class="page">주문 · 현장 관리</h1>
<div class="page-sub">전체 ${total}건</div>
<div class="filters">${filterLinks}</div>
<form method="get" action="/admin/projects" class="row" style="margin-bottom:14px">
  <input type="hidden" name="filter" value="${escapeHtml(filter)}">
  <input type="search" name="q" value="${escapeHtml(query || '')}" placeholder="고객명 · 전화번호 · 주문번호 · 현장명 · 제품명" style="min-width:300px;flex:1">
  <button class="btn" type="submit">검색</button>
  ${query ? `<a class="btn quiet" href="/admin/projects?filter=${filter}">초기화</a>` : ''}
</form>
<div class="card" style="padding:0">
  <div class="tablewrap"><table>
    <thead><tr><th>주문</th><th>고객</th><th>제품 / 현장</th><th>출고일</th><th>시공예정일</th><th>발송상태</th><th>사진</th><th>리워드</th></tr></thead>
    <tbody>${body || '<tr><td colspan="8" class="muted" style="padding:24px">조건에 맞는 주문이 없습니다.</td></tr>'}</tbody>
  </table></div>
</div>
<div class="pager">${pager.join('')}</div>`;
  return layout({ title: '주문·현장', active: '/admin/projects', session, content, flash });
}

function projectDetailPage({ project, customer, photos, messages, reward, rewardTiers, session, flash }) {
  const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">`;

  const photoCards = photos
    .map(
      (p) => `<div class="photo">
      <div class="img">
        <a href="/admin/media/${p.photo_id}" target="_blank" rel="noopener"><img src="/admin/media/${p.photo_id}" alt="시공사진" loading="lazy"></a>
        ${p.is_best ? '<span class="tag badge b-green">★ BEST</span>' : ''}
        ${p.needs_convert ? '<span class="tag badge b-amber" style="left:auto;right:7px">HEIC</span>' : ''}
      </div>
      <form method="post" action="/admin/photos/${p.photo_id}/review" class="acts">
        ${csrf}
        <button name="action" value="best" class="${p.is_best ? 'on' : ''}" title="BEST 컷">★</button>
        <button name="action" value="usable" class="${p.review_status === 'USABLE' ? 'on' : ''}">사용가능</button>
        <button name="action" value="unusable" class="${p.review_status === 'UNUSABLE' ? 'on' : ''}">사용불가</button>
      </form>
    </div>`
    )
    .join('');

  const messageRows = messages
    .map(
      (m) => `<tr>
      <td>${escapeHtml(TYPE_LABEL[m.message_type] || m.message_type)}</td>
      <td>${badge(MESSAGE_STATUS_BADGE, m.status)}</td>
      <td>${m.status === 'SCHEDULED' ? fmtDateTime(m.scheduled_at) : fmtDateTime(m.sent_at)}</td>
      <td>${escapeHtml(m.channel || '-')}</td>
      <td class="small muted">${escapeHtml(m.failure_reason || '')}</td>
    </tr>`
    )
    .join('');

  const rewardStatus = reward ? reward.status : 'PENDING';
  const amountOptions = rewardTiers.presets
    .map(
      (amount) =>
        `<option value="${amount}" ${reward && reward.amount === amount ? 'selected' : ''}>${
          amount === 0 ? '리워드 없음' : won(amount)
        }</option>`
    )
    .join('');

  const content = `
<div class="row" style="justify-content:space-between;margin-bottom:6px">
  <h1 class="page">${escapeHtml(project.order_number)} · ${escapeHtml(customer.name)}</h1>
  <a class="btn quiet sm" href="/admin/projects">목록으로</a>
</div>
<div class="page-sub">${badge(STATUS_BADGE, project.status)} ${
    project.message_excluded ? '<span class="badge b-red">자동발송 제외</span>' : ''
  }</div>

<div class="grid g2">
  <div class="card">
    <h2>현장 · 주문 정보</h2>
    <dl class="kv">
      <dt>주문번호</dt><dd>${escapeHtml(project.order_number)}</dd>
      <dt>제품</dt><dd>${escapeHtml(project.product || '-')} ${escapeHtml(project.quantity || '')}</dd>
      <dt>출고일</dt><dd>${escapeHtml(project.ship_date)}</dd>
      <dt>시공예정일</dt><dd>${escapeHtml(project.installation_date || '미정')}</dd>
      <dt>현장명</dt><dd>${escapeHtml(project.site_name || '-')}</dd>
      <dt>현장지역</dt><dd>${escapeHtml(project.region || '-')}</dd>
      <dt>담당자</dt><dd>${escapeHtml(project.sales_manager || '-')}</dd>
      <dt>시공업체</dt><dd>${escapeHtml(project.contractor || '-')}</dd>
      <dt>SNS</dt><dd>${escapeHtml(project.sns || '-')}</dd>
    </dl>
  </div>
  <div class="card">
    <h2>고객 정보</h2>
    <dl class="kv">
      <dt>고객명</dt><dd>${escapeHtml(customer.name)}</dd>
      <dt>연락처</dt><dd>${escapeHtml(formatPhone(customer.phone))}</dd>
      <dt>업로드 링크</dt><dd class="small"><a href="${escapeHtml(project.upload_url)}" target="_blank" rel="noopener">${escapeHtml(project.upload_url)}</a></dd>
      <dt>링크 열람</dt><dd>${project.open_count}회 ${
        project.first_opened_at ? `<span class="small muted">(최초 ${fmtDateTime(project.first_opened_at)})</span>` : ''
      }</dd>
      <dt>동의</dt><dd>${project.consent_at ? `동의 ${fmtDateTime(project.consent_at)}` : '<span class="muted">미동의</span>'}</dd>
      <dt>사진등록</dt><dd>${project.photo_submitted_at ? fmtDateTime(project.photo_submitted_at) : '<span class="muted">미등록</span>'}</dd>
    </dl>
  </div>
</div>

<div class="card">
  <h2>관리자 수동 제어</h2>
  <div class="row">
    <form method="post" action="/admin/projects/${project.project_id}/send" class="inline">
      ${csrf}<input type="hidden" name="type" value="FIRST">
      <button class="btn sm" type="submit">지금 1차 발송</button>
    </form>
    <form method="post" action="/admin/projects/${project.project_id}/send" class="inline">
      ${csrf}<input type="hidden" name="type" value="SECOND">
      <button class="btn sm ghost" type="submit">지금 2차 발송</button>
    </form>
    <form method="post" action="/admin/projects/${project.project_id}/send" class="inline">
      ${csrf}<input type="hidden" name="type" value="FINAL">
      <button class="btn sm ghost" type="submit">지금 최종 발송</button>
    </form>
    <form method="post" action="/admin/projects/${project.project_id}/stop" class="inline">
      ${csrf}<button class="btn sm quiet" type="submit">향후 발송 중단</button>
    </form>
    <form method="post" action="/admin/projects/${project.project_id}/exclude" class="inline">
      ${csrf}<input type="hidden" name="value" value="${project.message_excluded ? '0' : '1'}">
      <button class="btn sm ${project.message_excluded ? 'ghost' : 'danger'}" type="submit">
        ${project.message_excluded ? '발송 제외 해제' : '자동 메시지 발송 제외'}</button>
    </form>
  </div>
  <form method="post" action="/admin/projects/${project.project_id}/schedule" class="row" style="margin-top:14px">
    ${csrf}
    <label class="small muted">시공예정일 변경</label>
    <input type="date" name="installation_date" value="${escapeHtml(project.installation_date || '')}">
    <button class="btn sm ghost" type="submit">저장 후 재예약</button>
    <span class="small muted">변경 시 아직 발송되지 않은 1차 메시지가 다시 예약됩니다.</span>
  </form>
</div>

<div class="card">
  <h2>시공사진 <span class="sub">${photos.length}장${
    project.review_text ? '' : ''
  }</span></h2>
  ${photos.length ? `<div class="photos">${photoCards}</div>` : '<div class="muted">등록된 사진이 없습니다.</div>'}
  ${
    project.review_text
      ? `<div style="margin-top:16px"><div class="small muted">고객 시공후기</div><div style="margin-top:5px">${escapeHtml(project.review_text)}</div></div>`
      : ''
  }
  <form method="post" action="/admin/projects/${project.project_id}/photos" enctype="multipart/form-data" class="row" style="margin-top:16px">
    ${csrf}
    <input type="file" name="photos" accept="image/*" multiple>
    <button class="btn sm ghost" type="submit">사진 직접 등록</button>
    <span class="small muted">고객이 카카오톡으로 사진을 보낸 경우 관리자가 대신 등록합니다.</span>
  </form>
</div>

<div class="grid g2">
  <div class="card">
    <h2>리워드</h2>
    <form method="post" action="/admin/projects/${project.project_id}/reward">
      ${csrf}
      <div class="row" style="margin-bottom:10px">
        <select name="amount_preset">${amountOptions}<option value="custom">직접입력</option></select>
        <input type="number" name="amount_custom" placeholder="직접입력 금액" min="0" step="1000" style="width:150px">
        <select name="status">
          ${Object.entries(REWARD_BADGE)
            .map(([key, [label]]) => `<option value="${key}" ${rewardStatus === key ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field"><textarea name="memo" placeholder="관리자 메모">${escapeHtml(reward ? reward.memo || '' : '')}</textarea></div>
      <div class="row">
        <button class="btn sm" type="submit">저장</button>
        <span class="small muted">${
          reward && reward.paid_at ? `지급완료일 ${fmtDateTime(reward.paid_at)}` : 'MVP 에서는 실제 송금 없이 지급 여부만 관리합니다.'
        }</span>
      </div>
    </form>
  </div>
  <div class="card">
    <h2>발송 이력</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>구분</th><th>상태</th><th>시각</th><th>채널</th><th>비고</th></tr></thead>
      <tbody>${messageRows || '<tr><td colspan="5" class="muted">발송 이력이 없습니다.</td></tr>'}</tbody>
    </table></div>
  </div>
</div>`;
  return layout({ title: project.order_number, active: '/admin/projects', session, content, flash });
}

function reviewPage({ rows, session, flash }) {
  const cards = rows
    .map(
      (r) => `<div class="card">
    <h2><a href="/admin/projects/${r.project_id}">${escapeHtml(r.order_number)} · ${escapeHtml(r.site_name || r.customer_name)}</a>
      <span class="sub">${fmtDateTime(r.photo_submitted_at)} · ${r.photo_count}장 · ${badge(REWARD_BADGE, r.reward_status || 'PENDING')}</span></h2>
    <div class="photos">${r.photos
      .map(
        (p) => `<div class="photo"><div class="img">
          <a href="/admin/media/${p.photo_id}" target="_blank" rel="noopener"><img src="/admin/media/${p.photo_id}" alt="" loading="lazy"></a>
          ${p.is_best ? '<span class="tag badge b-green">★</span>' : ''}
          ${p.review_status === 'UNUSABLE' ? '<span class="tag badge b-red">사용불가</span>' : ''}
          ${p.review_status === 'USABLE' && !p.is_best ? '<span class="tag badge b-blue">사용가능</span>' : ''}
        </div></div>`
      )
      .join('')}</div>
    <div class="row" style="margin-top:12px">
      <a class="btn sm ghost" href="/admin/projects/${r.project_id}">검수하기</a>
      <span class="small muted">${escapeHtml(r.product || '')} · ${escapeHtml(r.region || '')}</span>
    </div>
  </div>`
    )
    .join('');

  const content = `
<h1 class="page">사진 검수</h1>
<div class="page-sub">검수 대기 ${rows.length}건 · 사진별로 ★ BEST / 사용가능 / 사용불가를 지정합니다.</div>
${cards || '<div class="card muted">검수 대기 중인 현장이 없습니다.</div>'}`;
  return layout({ title: '사진 검수', active: '/admin/review', session, content, flash });
}

function rewardsPage({ rows, filter, totals, session, flash }) {
  const links = [['all', '전체'], ...Object.entries(REWARD_BADGE).map(([key, [label]]) => [key, label])]
    .map(([key, label]) => `<a class="${filter === key ? 'on' : ''}" href="/admin/rewards?filter=${key}">${escapeHtml(label)}</a>`)
    .join('');

  const body = rows
    .map(
      (r) => `<tr>
    <td><a href="/admin/projects/${r.project_id}"><b>${escapeHtml(r.order_number)}</b></a></td>
    <td>${escapeHtml(r.customer_name)}</td>
    <td>${escapeHtml(r.site_name || '-')}</td>
    <td class="num">${r.photo_count}장</td>
    <td class="num">${won(r.amount)}</td>
    <td>${badge(REWARD_BADGE, r.status)}</td>
    <td>${r.paid_at ? fmtDateTime(r.paid_at) : '-'}</td>
    <td class="small muted">${escapeHtml(r.memo || '')}</td>
  </tr>`
    )
    .join('');

  const content = `
<h1 class="page">리워드 관리</h1>
<div class="page-sub">검토대기 ${totals.pending}건 · 지급예정 ${totals.scheduled}건 · 지급완료 ${totals.paid}건 (${won(totals.paid_amount)})</div>
<div class="filters">${links}</div>
<div class="card" style="padding:0"><div class="tablewrap"><table>
  <thead><tr><th>주문</th><th>고객</th><th>현장</th><th class="num">사진</th><th class="num">금액</th><th>상태</th><th>지급완료일</th><th>메모</th></tr></thead>
  <tbody>${body || '<tr><td colspan="8" class="muted" style="padding:24px">대상이 없습니다.</td></tr>'}</tbody>
</table></div></div>`;
  return layout({ title: '리워드', active: '/admin/rewards', session, content, flash });
}

function messagesPage({ rows, filter, page, pages, session, flash, stats }) {
  const links = [
    ['all', '전체'],
    ['SCHEDULED', '예약'],
    ['SENT', '발송완료'],
    ['SENT_SMS', 'SMS 대체'],
    ['FAILED', '발송실패'],
    ['CANCELED_PHOTO', '사진등록 취소'],
  ]
    .map(([key, label]) => `<a class="${filter === key ? 'on' : ''}" href="/admin/messages?filter=${key}">${escapeHtml(label)}</a>`)
    .join('');

  const body = rows
    .map(
      (m) => `<tr>
    <td>${escapeHtml(m.customer_name)}<div class="small muted">${escapeHtml(maskPhone(m.phone))}</div></td>
    <td>${m.project_id ? `<a href="/admin/projects/${m.project_id}">${escapeHtml(m.order_number || '-')}</a>` : '<span class="muted">-</span>'}</td>
    <td>${escapeHtml(TYPE_LABEL[m.message_type] || m.message_type)}</td>
    <td>${m.status === 'SCHEDULED' ? `예약 ${fmtDateTime(m.scheduled_at)}` : fmtDateTime(m.sent_at)}</td>
    <td>${badge(MESSAGE_STATUS_BADGE, m.status)}</td>
    <td>${escapeHtml(m.channel || '-')}</td>
    <td>${m.photo_count ? `<span class="badge b-green">${m.photo_count}장</span>` : '<span class="muted">미등록</span>'}</td>
    <td class="small muted">${escapeHtml(m.failure_reason || '')}</td>
  </tr>`
    )
    .join('');

  const pager = [];
  for (let p = 1; p <= pages; p++) {
    if (pages > 9 && Math.abs(p - page) > 3 && p !== 1 && p !== pages) continue;
    pager.push(p === page ? `<span class="on">${p}</span>` : `<a href="/admin/messages?filter=${filter}&page=${p}">${p}</a>`);
  }

  const content = `
<h1 class="page">발송 로그</h1>
<div class="page-sub">총 ${stats.messages_total}건 발송 · 알림톡 성공률 ${pct(stats.alimtalk_rate)} · SMS 대체 ${stats.sms_fallback}건 · 실패 ${stats.failed}건</div>
<div class="filters">${links}</div>
<div class="card" style="padding:0"><div class="tablewrap"><table>
  <thead><tr><th>고객</th><th>주문</th><th>종류</th><th>발송일시</th><th>상태</th><th>채널</th><th>사진</th><th>비고</th></tr></thead>
  <tbody>${body || '<tr><td colspan="8" class="muted" style="padding:24px">기록이 없습니다.</td></tr>'}</tbody>
</table></div></div>
<div class="pager">${pager.join('')}</div>`;
  return layout({ title: '발송 로그', active: '/admin/messages', session, content, flash });
}

function importPage({ session, flash, recent }) {
  const rows = recent
    .map(
      (b) => `<tr>
      <td>${escapeHtml(b.file_name || '-')}</td>
      <td>${fmtDateTime(b.created_at)}</td>
      <td class="num">${b.total_rows}</td>
      <td class="num">${b.valid_rows}</td>
      <td>${escapeHtml({ PREVIEW: '미리보기', COMMITTED: '등록완료', DISCARDED: '취소' }[b.status] || b.status)}</td>
      <td>${b.status === 'PREVIEW' ? `<a class="btn sm ghost" href="/admin/import/${b.batch_id}">이어서 확인</a>` : ''}</td>
    </tr>`
    )
    .join('');

  const content = `
<h1 class="page">출고 엑셀 업로드</h1>
<div class="page-sub">업로드 후 미리보기에서 확인한 뒤 등록합니다. 등록 즉시 전체 발송되지 않습니다.</div>
<div class="card">
  <form method="post" action="/admin/import" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <div class="field">
      <label>출고 엑셀 파일 (.xlsx / .csv)</label>
      <input type="file" name="file" accept=".xlsx,.csv,.tsv,text/csv" required>
      <div class="hint">이카운트 <b>판매조회</b> 내려받기를 그대로 올리면 됩니다 (일자-No. · 거래처명 · 연락처 · 품목명 · 금액합계).</div>
      <div class="hint">필수 항목: 주문번호(일자-No.) · 출고일 · 고객명(거래처명) · 휴대폰번호(연락처) / 선택: 제품명 · 수량 · 현장명 · 현장지역 · 시공예정일 · 담당자</div>
      <div class="hint">출고일 열이 없으면 일자-No. 앞의 날짜를 씁니다. 금액이 마이너스인 행은 취소로 보고 해당 주문의 발송을 막습니다.</div>
    </div>
    <button class="btn" type="submit">미리보기</button>
  </form>
</div>
<div class="card" style="padding:0">
  <div class="tablewrap"><table>
    <thead><tr><th>파일</th><th>업로드 일시</th><th class="num">총 건수</th><th class="num">정상</th><th>상태</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted" style="padding:24px">업로드 이력이 없습니다.</td></tr>'}</tbody>
  </table></div>
</div>`;
  return layout({ title: '엑셀 업로드', active: '/admin/import', session, content, flash });
}

function importPreviewPage({ batch, rows, summary, session, flash }) {
  const body = rows
    .map((r) => {
      const problems = [...r.errors.map((e) => `<span class="badge b-red">${escapeHtml(e.text)}</span>`),
        ...r.warnings.map((w) => `<span class="badge b-amber">${escapeHtml(w.text)}</span>`)].join(' ');
      return `<tr style="${r.valid ? '' : 'background:#FEF7F6'}">
      <td class="muted">${r.line}</td>
      <td>${escapeHtml(r.order_number || '-')}</td>
      <td>${escapeHtml(r.customer_name || '-')}</td>
      <td>${escapeHtml(r.phone ? formatPhone(r.phone) : r.phone_raw || '-')}</td>
      <td>${escapeHtml(r.product || '-')}</td>
      <td>${escapeHtml(r.ship_date || '-')}</td>
      <td>${escapeHtml(r.installation_date || '미정')}</td>
      <td>${problems || '<span class="badge b-green">정상</span>'}</td>
    </tr>`;
    })
    .join('');

  const content = `
<h1 class="page">업로드 미리보기</h1>
<div class="page-sub">${escapeHtml(batch.file_name || '')} · ${fmtDateTime(batch.created_at)}</div>
<div class="grid g4" style="margin-bottom:16px">
  <div class="tile"><div class="k">총 건수</div><div class="v">${summary.total}</div></div>
  <div class="tile hi"><div class="k">정상</div><div class="v">${summary.valid}</div></div>
  <div class="tile"><div class="k">전화번호 오류</div><div class="v">${summary.bad_phone}</div></div>
  <div class="tile"><div class="k">중복 주문</div><div class="v">${summary.duplicate}</div></div>
</div>
${
  summary.canceled
    ? `<div class="flash info">취소(마이너스) 전표 ${summary.canceled}건이 있습니다. 등록하면 해당 주문의 자동 발송을 중단합니다.</div>`
    : ''
}
${summary.other ? `<div class="flash err">기타 오류 ${summary.other}건은 등록되지 않습니다.</div>` : ''}
<div class="card">
  <form method="post" action="/admin/import/${batch.batch_id}/commit" class="row">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <button class="btn" type="submit" name="mode" value="schedule" ${summary.valid || summary.canceled ? '' : 'disabled'}>${summary.valid}건 등록 · 자동발송 예약</button>
    <button class="btn ghost" type="submit" name="mode" value="hold" ${summary.valid || summary.canceled ? '' : 'disabled'}>${summary.valid}건 등록 · 발송 보류</button>
    <a class="btn quiet" href="/admin/import/${batch.batch_id}/discard">취소</a>
    <span class="small muted">예약 시각이 이미 지난 건은 즉시 발송되지 않고 다음 발송창으로 예약됩니다.</span>
  </form>
</div>
<div class="card" style="padding:0"><div class="tablewrap"><table>
  <thead><tr><th>행</th><th>주문번호</th><th>고객명</th><th>휴대폰</th><th>제품</th><th>출고일</th><th>시공예정일</th><th>검증</th></tr></thead>
  <tbody>${body}</tbody>
</table></div></div>`;
  return layout({ title: '업로드 미리보기', active: '/admin/import', session, content, flash });
}

function settingsPage({ session, flash, settings, audits, provider, baseUrl, rewardTiers, sentToday, messagePreview }) {
  const auditRows = audits
    .map(
      (a) => `<tr>
      <td>${fmtDateTime(a.created_at)}</td>
      <td>${escapeHtml(a.username || '-')}</td>
      <td>${escapeHtml(a.action)}</td>
      <td class="small muted">${escapeHtml(a.target || '')} ${escapeHtml(a.detail || '')}</td>
    </tr>`
    )
    .join('');

  const content = `
<h1 class="page">설정</h1>
<div class="page-sub">발송 채널: ${escapeHtml(provider)} · 업로드 기본 주소: ${escapeHtml(baseUrl)} · 오늘 발송 ${sentToday}건${
    Number(settings.daily_send_limit) > 0 ? ` / 한도 ${escapeHtml(settings.daily_send_limit)}건` : ''
  }</div>

<div class="card">
  <h2>발송될 1차 메시지 <span class="sub">${escapeHtml(messagePreview.meta)}</span></h2>
  <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.7;background:#FAFAF9;border:1px solid var(--line);border-radius:8px;padding:14px;margin:0">${escapeHtml(messagePreview.body)}</pre>
</div>

<div class="card">
  <h2>테스트 발송</h2>
  <form method="post" action="/admin/test-send" class="row">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <input type="text" name="phone" value="${escapeHtml(settings.test_phone || '')}" placeholder="010-0000-0000">
    <select name="type"><option value="FIRST">1차 메시지</option><option value="SECOND">2차 메시지</option><option value="FINAL">최종 메시지</option></select>
    <button class="btn" type="submit">관리자 번호로 테스트 발송</button>
  </form>
  <div class="hint small muted" style="margin-top:8px">실제 고객 발송 전 반드시 테스트 발송으로 문구와 링크를 확인하세요.</div>
</div>

<div class="card">
  <h2>문구 관리</h2>
  <form method="post" action="/admin/settings">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <div class="field">
      <label>사진 활용 동의 문구 (필수 체크박스)</label>
      <textarea name="consent_text">${escapeHtml(settings.consent_text)}</textarea>
    </div>
    <div class="field">
      <label>개인정보 안내 문구</label>
      <textarea name="privacy_text">${escapeHtml(settings.privacy_text)}</textarea>
    </div>
    <div class="field">
      <label>리워드 제목 (고객 화면 상단 굵은 문구)</label>
      <textarea name="reward_headline" style="min-height:60px">${escapeHtml(settings.reward_headline)}</textarea>
      <div class="hint">줄을 바꾸면 고객 화면에서도 그대로 줄이 바뀝니다.</div>
    </div>
    <div class="field">
      <label>혜택 목록 (한 줄에 하나씩)</label>
      <textarea name="reward_benefits">${escapeHtml(settings.reward_benefits)}</textarea>
      <div class="hint">승인된 알림톡 내용과 같게 맞추세요. 화면과 메시지가 다르면 고객 불만이 생깁니다.</div>
    </div>
    <div class="field">
      <label>지급 기준 안내 (작은 글씨)</label>
      <textarea name="reward_criteria_text">${escapeHtml(settings.reward_criteria_text)}</textarea>
    </div>
    <div class="field">
      <label>로고 이미지 주소 (비우면 STONE KIM 글자 로고)</label>
      <input type="text" name="brand_logo_url" value="${escapeHtml(settings.brand_logo_url)}" placeholder="https://stonekim.kr/logo.png" style="width:100%;max-width:520px">
    </div>
    <div class="row">
      <div class="field" style="margin:0"><label>메시지 문구 유형</label>
        <select name="message_variant">
          <option value="reward" ${settings.message_variant !== 'info' ? 'selected' : ''}>리워드 기준 명시 (등록률 우선)</option>
          <option value="info" ${settings.message_variant === 'info' ? 'selected' : ''}>정보성 문구 (알림톡 심사 우선)</option>
        </select>
        <div class="hint">알림톡 템플릿이 광고성으로 반려되면 정보성으로 바꾸세요.<br>리워드 금액은 업로드 페이지에서 계속 안내됩니다.</div></div>
      <div class="field" style="margin:0"><label>자동 발송 단계</label>
        <select name="send_stages">
          <option value="1" ${String(settings.send_stages) === '1' ? 'selected' : ''}>1차만 발송</option>
          <option value="2" ${String(settings.send_stages) === '2' ? 'selected' : ''}>1차 + 2차</option>
          <option value="3" ${String(settings.send_stages) === '3' ? 'selected' : ''}>1차 + 2차 + 최종</option>
        </select>
        <div class="hint">승인된 알림톡 템플릿 수에 맞춰 설정하세요.<br>승인 안 된 단계를 켜두면 문자로 대체발송됩니다.</div></div>
      <div class="field" style="margin:0"><label>일일 발송 한도 (0=무제한)</label>
        <input type="number" name="daily_send_limit" min="0" max="10000" value="${escapeHtml(settings.daily_send_limit)}" style="width:150px">
        <div class="hint">소규모 오픈 시 하루 발송 건수를 제한합니다.</div></div>
    </div>
    <div class="row">
      <div class="field" style="margin:0;flex:1"><label>발송 허용 번호 (쉼표로 구분 · 비우면 전체 발송)</label>
        <input type="text" name="send_allowlist" value="${escapeHtml(settings.send_allowlist)}" placeholder="010-1234-5678, 010-2222-3333" style="width:100%;max-width:420px">
        <div class="hint">값이 있으면 <b>그 번호에만</b> 발송됩니다. 실전 테스트 중에는 대표님 번호만 넣어 두세요.<br>
          나머지 주문의 예약은 취소되지 않고 그대로 대기합니다.</div></div>
    </div>
    <div class="row">
      <div class="field" style="margin:0"><label>최소 사진 수</label><input type="number" name="min_photos" min="1" max="10" value="${escapeHtml(settings.min_photos)}" style="width:110px"></div>
      <div class="field" style="margin:0"><label>최대 사진 수</label><input type="number" name="max_photos" min="1" max="20" value="${escapeHtml(settings.max_photos)}" style="width:110px"></div>
      <div class="field" style="margin:0"><label>발송 시각 (KST)</label><input type="number" name="send_hour_kst" min="0" max="23" value="${escapeHtml(settings.send_hour_kst)}" style="width:110px"></div>
      <div class="field" style="margin:0"><label>테스트 수신번호</label><input type="text" name="test_phone" value="${escapeHtml(settings.test_phone || '')}" style="width:170px"></div>
    </div>
    <button class="btn" type="submit">저장</button>
  </form>
</div>

<div class="card">
  <h2>비밀번호 변경</h2>
  <form method="post" action="/admin/password" class="row">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <input type="password" name="current" placeholder="현재 비밀번호" autocomplete="current-password">
    <input type="password" name="next" placeholder="새 비밀번호 (8자 이상)" autocomplete="new-password">
    <button class="btn" type="submit">변경</button>
  </form>
</div>

<div class="card" style="padding:0">
  <div style="padding:18px 18px 0"><h2>관리자 작업 로그</h2></div>
  <div class="tablewrap"><table>
    <thead><tr><th>일시</th><th>계정</th><th>작업</th><th>대상</th></tr></thead>
    <tbody>${auditRows || '<tr><td colspan="4" class="muted" style="padding:20px">기록이 없습니다.</td></tr>'}</tbody>
  </table></div>
</div>`;
  return layout({ title: '설정', active: '/admin/settings', session, content, flash });
}


const ROLE_LABEL = { OWNER: '관리자 (전체 권한)', STAFF: '직원 (설정 제외)' };

function usersPage({ users, session, flash, newAccount }) {
  const rows = users
    .map((u) => {
      const self = u.user_id === session.user_id;
      return `<tr style="${u.active ? '' : 'opacity:.55'}">
      <td><b>${escapeHtml(u.username)}</b>${self ? ' <span class="badge b-green">나</span>' : ''}</td>
      <td>${escapeHtml(u.display_name || '')}</td>
      <td>${u.role === 'OWNER' ? '<span class="badge b-amber">관리자</span>' : '<span class="badge">직원</span>'}</td>
      <td>${u.active ? '사용중' : '<span class="muted">중지됨</span>'}${
        u.must_change_password ? ' <span class="badge b-amber">비밀번호 변경 필요</span>' : ''
      }</td>
      <td class="small muted">${u.last_login_at ? fmtDateTime(u.last_login_at) : '로그인 기록 없음'}</td>
      <td class="right">${
        self
          ? '<span class="small muted">본인 계정</span>'
          : `<form method="post" action="/admin/users/${u.user_id}/reset" class="inline">
               <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
               <button class="btn sm quiet" type="submit">비밀번호 초기화</button>
             </form>
             <form method="post" action="/admin/users/${u.user_id}/active" class="inline">
               <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
               <input type="hidden" name="value" value="${u.active ? '0' : '1'}">
               <button class="btn sm ${u.active ? 'danger' : 'ghost'}" type="submit">${u.active ? '사용 중지' : '다시 사용'}</button>
             </form>`
      }</td>
    </tr>`;
    })
    .join('');

  const created = newAccount
    ? `<div class="flash ok">
         <b>${escapeHtml(newAccount.username)}</b> 계정을 만들었습니다. 아래 임시 비밀번호를 직원에게 전달하세요.
         이 화면을 벗어나면 다시 볼 수 없습니다 (분실하면 초기화하면 됩니다).
         <div style="margin-top:8px;font-size:20px;font-weight:700;letter-spacing:1px">${escapeHtml(newAccount.password)}</div>
         <div class="small" style="margin-top:6px">직원은 첫 로그인에서 비밀번호를 바꿔야 들어올 수 있습니다.</div>
       </div>`
    : '';

  const content = `
<h1 class="page">계정 관리</h1>
<div class="page-sub">직원마다 계정을 따로 주세요. 누가 무엇을 했는지 기록이 남고, 퇴사하면 그 계정만 끄면 됩니다.</div>
${created}
<div class="card">
  <h2>직원 계정 추가</h2>
  <form method="post" action="/admin/users" class="row" style="align-items:flex-end">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <div class="field"><label>아이디</label><input name="username" required placeholder="younghee" pattern="[A-Za-z0-9._-]{3,30}"></div>
    <div class="field"><label>이름</label><input name="display_name" required placeholder="김영희"></div>
    <div class="field"><label>권한</label>
      <select name="role">
        <option value="STAFF">직원 — 업로드·검수·리워드 (설정 제외)</option>
        <option value="OWNER">관리자 — 설정·계정까지 전부</option>
      </select>
    </div>
    <button class="btn" type="submit">계정 만들기</button>
  </form>
  <div class="hint" style="margin-top:10px">임시 비밀번호는 시스템이 만들어 화면에 한 번 보여줍니다.</div>
</div>
<div class="card" style="padding:0"><div class="tablewrap"><table>
  <thead><tr><th>아이디</th><th>이름</th><th>권한</th><th>상태</th><th>마지막 로그인</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table></div></div>
<div class="card">
  <h2>권한이 하는 일</h2>
  <div class="kv">
    <div>직원</div><div>대시보드 · 주문·현장 · 사진 검수 · 리워드 · 발송 로그 · 엑셀 업로드</div>
    <div>관리자</div><div>직원이 하는 전부 + <b>설정</b>(발송 허용 번호, 알림톡 채널, 리워드 문구) + <b>계정 관리</b></div>
  </div>
  <div class="hint" style="margin-top:10px">발송 허용 번호를 비우면 실제 고객에게 나가기 시작합니다. 그래서 설정은 관리자만 들어갑니다.</div>
</div>`;
  return layout({ title: '계정 관리', active: '/admin/users', session, content, flash });
}

function passwordPage({ session, flash, forced }) {
  const content = `
<h1 class="page">비밀번호 변경</h1>
${
  forced
    ? '<div class="flash err">임시 비밀번호로 로그인하셨습니다. 새 비밀번호를 정해야 다른 화면으로 갈 수 있습니다.</div>'
    : ''
}
<div class="card" style="max-width:460px">
  <form method="post" action="/admin/password">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <div class="field"><label>현재 비밀번호</label><input type="password" name="current" required autocomplete="current-password"></div>
    <div class="field"><label>새 비밀번호 (8자 이상)</label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div>
    <div class="field"><label>새 비밀번호 확인</label><input type="password" name="confirm" required minlength="8" autocomplete="new-password"></div>
    <button class="btn" type="submit">변경</button>
  </form>
</div>`;
  return layout({ title: '비밀번호 변경', active: '', session, content, flash });
}

module.exports = {
  layout,
  loginPage,
  dashboardPage,
  projectsPage,
  projectDetailPage,
  reviewPage,
  rewardsPage,
  messagesPage,
  importPage,
  importPreviewPage,
  settingsPage,
  usersPage,
  passwordPage,
  CSS,
  STATUS_BADGE,
  MESSAGE_STATUS_BADGE,
  REWARD_BADGE,
  FILTERS,
};
