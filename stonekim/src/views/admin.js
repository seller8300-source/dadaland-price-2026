'use strict';
const { escapeHtml, fmtDate, fmtDateTime, formatPhone, maskPhone, won } = require('../util');

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#14181A;--muted:#707A7E;--line:#E4E6E5;--bg:#F6F6F4;--card:#fff;--accent:#14181A;
  --ok:#1E7A46;--warn:#B25000;--err:#B3261E;--info:#26506E}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;
  background:var(--bg);color:var(--ink);font-size:14px;line-height:1.55;word-break:keep-all}
a{color:inherit;text-decoration:none}
.top{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.top-in{max-width:1180px;margin:0 auto;padding:0 18px;display:flex;align-items:center;gap:22px;height:56px}
.logo{font-weight:700;letter-spacing:.24em;font-size:13px}
nav{display:flex;gap:2px;flex:1;overflow-x:auto}
nav a{padding:8px 12px;border-radius:7px;font-size:13.5px;color:var(--muted);white-space:nowrap}
nav a:hover{background:var(--bg)}
nav a.on{background:var(--ink);color:#fff}
.who{font-size:12.5px;color:var(--muted);display:flex;gap:10px;align-items:center;white-space:nowrap}
.wrap{max-width:1180px;margin:0 auto;padding:22px 18px 60px}
h1.page{font-size:20px;font-weight:600;margin-bottom:4px}
.page-sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.grid{display:grid;gap:12px}
.g4{grid-template-columns:repeat(4,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
@media(max-width:860px){.g4,.g3,.g2{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.g4,.g3,.g2{grid-template-columns:1fr}}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:15px 16px}
.tile .k{font-size:12.5px;color:var(--muted)}
.tile .v{font-size:25px;font-weight:600;margin-top:5px;letter-spacing:-.02em}
.tile .v small{font-size:13px;font-weight:400;color:var(--muted);margin-left:4px}
.tile.hi{background:var(--ink);color:#fff}
.tile.hi .k{color:#B9C0C2}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
.card h2{font-size:15px;font-weight:600;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.card h2 .sub{font-size:12px;color:var(--muted);font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13.3px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:600;background:#FAFAF9;white-space:nowrap}
tbody tr:hover{background:#FAFAF9}
td.num,th.num{text-align:right}
.tablewrap{overflow-x:auto}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
.b-gray{background:#EEF0EF;color:#5B6467}
.b-blue{background:#E4EEF6;color:var(--info)}
.b-green{background:#E2F1E8;color:var(--ok)}
.b-amber{background:#FBEEDD;color:var(--warn)}
.b-red{background:#FBE7E5;color:var(--err)}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.filters a{padding:6px 12px;border:1px solid var(--line);border-radius:99px;background:#fff;font-size:12.5px;color:var(--muted)}
.filters a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
form.inline{display:inline}
input[type=text],input[type=password],input[type=search],input[type=number],input[type=date],select,textarea{
  padding:9px 11px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13.5px;background:#fff;color:var(--ink);outline:none;max-width:100%}
input:focus,select:focus,textarea:focus{border-color:var(--ink)}
textarea{width:100%;min-height:80px;line-height:1.6;resize:vertical}
.btn{display:inline-block;padding:9px 14px;border:1px solid var(--ink);border-radius:7px;background:var(--ink);
  color:#fff;font-family:inherit;font-size:13.3px;font-weight:500;cursor:pointer}
.btn:hover{opacity:.88}
.btn.ghost{background:#fff;color:var(--ink)}
.btn.sm{padding:6px 10px;font-size:12.5px}
.btn.danger{background:var(--err);border-color:var(--err)}
.btn.quiet{background:#fff;color:var(--muted);border-color:var(--line)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
.field .hint{font-size:12px;color:var(--muted);margin-top:4px}
.flash{padding:11px 14px;border-radius:8px;margin-bottom:16px;font-size:13.3px}
.flash.ok{background:#E2F1E8;color:var(--ok)}
.flash.err{background:#FBE7E5;color:var(--err)}
.flash.info{background:#E4EEF6;color:var(--info)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.photo{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff}
.photo .img{position:relative;padding-top:72%;background:#EDEDEA}
.photo .img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo .img .tag{position:absolute;top:7px;left:7px}
.photo .acts{display:flex;gap:4px;padding:8px}
.photo .acts button{flex:1;padding:6px 2px;font-size:11.5px;border:1px solid var(--line);border-radius:6px;
  background:#fff;cursor:pointer;font-family:inherit}
.photo .acts button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.kv{display:grid;grid-template-columns:110px 1fr;gap:7px 12px;font-size:13.3px}
.kv dt{color:var(--muted)}
.login{max-width:360px;margin:12vh auto;background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px}
.login .logo{margin-bottom:20px}
.login input{width:100%}
.muted{color:var(--muted)}
.small{font-size:12.3px}
.right{text-align:right}
.pager{display:flex;gap:6px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.pager a,.pager span{padding:6px 11px;border:1px solid var(--line);border-radius:7px;background:#fff;font-size:12.5px}
.pager span.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.bar{height:7px;border-radius:4px;background:#EDEFEE;overflow:hidden;margin-top:7px}
.bar i{display:block;height:100%;background:var(--ink)}
`;

const NAV = [
  ['/admin', '대시보드'],
  ['/admin/projects', '주문·현장'],
  ['/admin/review', '사진 검수'],
  ['/admin/rewards', '리워드'],
  ['/admin/messages', '발송 로그'],
  ['/admin/import', '엑셀 업로드'],
  ['/admin/settings', '설정'],
];

function layout({ title, active, session, content, flash }) {
  const nav = NAV.map(
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
<div class="wrap">${flashHtml}${content}</div>
</body></html>`;
}

function loginPage({ error, notice }) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
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

<div class="grid g4" style="margin-bottom:12px">
  ${tile('총 출고 현장', stats.shipped)}
  ${tile('메시지 발송 대상', stats.targeted)}
  ${tile('사진 등록 현장', stats.photo_projects)}
  ${tile('사진 등록률', pct(stats.photo_rate), '', true)}
</div>
<div class="grid g4" style="margin-bottom:12px">
  ${tile('1차 발송', stats.sent_first)}
  ${tile('2차 발송', stats.sent_second)}
  ${tile('최종 발송', stats.sent_final)}
  ${tile('예약 대기', stats.scheduled_ahead)}
</div>
<div class="grid g4" style="margin-bottom:22px">
  ${tile('홍보 활용 승인', stats.usable_projects, ' <small>현장</small>')}
  ${tile('리워드 검토대기', stats.pending_review)}
  ${tile('리워드 지급 완료', stats.reward_paid_count, ' <small>건</small>')}
  ${tile('리워드 지급액', won(stats.reward_paid_amount).replace('원', ''), ' <small>원</small>')}
</div>

<div class="card">
  <h2>MVP 성공 기준 지표 <span class="sub">누적</span></h2>
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
</div>

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
    .map((amount) => {
      const note =
        amount === rewardTiers.base ? ' · 기본' : amount === rewardTiers.max ? ' · 시공사례 선정' : '';
      return `<option value="${amount}" ${reward && reward.amount === amount ? 'selected' : ''}>${
        amount === 0 ? '리워드 없음' : won(amount) + note
      }</option>`;
    })
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
      <div class="hint">필수 항목: 주문번호 · 출고일 · 고객명 · 휴대폰번호 / 선택: 제품명 · 수량 · 현장명 · 현장지역 · 시공예정일 · 담당자</div>
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
${summary.other ? `<div class="flash err">기타 오류 ${summary.other}건은 등록되지 않습니다.</div>` : ''}
<div class="card">
  <form method="post" action="/admin/import/${batch.batch_id}/commit" class="row">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
    <button class="btn" type="submit" name="mode" value="schedule" ${summary.valid ? '' : 'disabled'}>${summary.valid}건 등록 · 자동발송 예약</button>
    <button class="btn ghost" type="submit" name="mode" value="hold" ${summary.valid ? '' : 'disabled'}>${summary.valid}건 등록 · 발송 보류</button>
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
      <label>리워드 기준 안내 문구 (고객 화면·완료 화면)</label>
      <textarea name="reward_criteria_text">${escapeHtml(settings.reward_criteria_text)}</textarea>
      <div class="hint">고객에게 보이는 문구: <b>${escapeHtml(rewardTiers.headline)}</b></div>
    </div>
    <div class="row">
      <div class="field" style="margin:0"><label>기본 리워드 (사진 등록 확인)</label>
        <input type="number" name="reward_base_amount" min="0" step="1000" value="${escapeHtml(settings.reward_base_amount)}" style="width:150px"></div>
      <div class="field" style="margin:0"><label>최대 리워드 (시공사례 선정)</label>
        <input type="number" name="reward_max_amount" min="0" step="1000" value="${escapeHtml(settings.reward_max_amount)}" style="width:150px"></div>
      <div class="field" style="margin:0"><label>메시지 문구 유형</label>
        <select name="message_variant">
          <option value="reward" ${settings.message_variant !== 'info' ? 'selected' : ''}>리워드 기준 명시 (등록률 우선)</option>
          <option value="info" ${settings.message_variant === 'info' ? 'selected' : ''}>정보성 문구 (알림톡 심사 우선)</option>
        </select>
        <div class="hint">알림톡 템플릿이 광고성으로 반려되면 정보성으로 바꾸세요.<br>리워드 금액은 업로드 페이지에서 계속 안내됩니다.</div></div>
      <div class="field" style="margin:0"><label>일일 발송 한도 (0=무제한)</label>
        <input type="number" name="daily_send_limit" min="0" max="10000" value="${escapeHtml(settings.daily_send_limit)}" style="width:150px">
        <div class="hint">소규모 오픈 시 하루 발송 건수를 제한합니다.</div></div>
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
  CSS,
  STATUS_BADGE,
  MESSAGE_STATUS_BADGE,
  REWARD_BADGE,
  FILTERS,
};
