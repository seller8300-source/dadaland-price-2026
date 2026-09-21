'use strict';
const { escapeHtml } = require('../util');

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#14181A;--muted:#6B7478;--line:#E3E5E4;--bg:#FFFFFF;--soft:#F5F5F3;--accent:#14181A;--warn:#C0392B}
html,body{background:var(--soft)}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;
  color:var(--ink);line-height:1.6;-webkit-text-size-adjust:100%;word-break:keep-all}
.wrap{max-width:560px;margin:0 auto;background:var(--bg);min-height:100vh}
header{padding:26px 20px 20px;border-bottom:1px solid var(--line)}
.brand{font-size:13px;letter-spacing:.34em;font-weight:700}
.page-title{margin-top:7px;font-size:19px;font-weight:600}
main{padding:22px 20px 40px}
.lead{font-size:15px;line-height:1.75;margin-bottom:6px}
.lead b{font-weight:600}
.sub{font-size:13px;color:var(--muted);margin-bottom:22px}
.card{border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px;background:#fff}
.card h2{font-size:14px;font-weight:600;margin-bottom:10px}
.reward{border:1px solid var(--ink);border-radius:12px;padding:15px 16px;margin-bottom:18px}
.reward .rh{font-size:14.5px;font-weight:600;line-height:1.5}
.reward ul{list-style:none;margin-top:10px}
.reward li{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:5px 0;border-top:1px solid var(--line)}
.reward li b{font-weight:600;white-space:nowrap}
.reward .rc{margin-top:10px;font-size:11.8px;color:var(--muted);line-height:1.7}
.order-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--muted)}
.order-row span:last-child{color:var(--ink);text-align:right;max-width:62%}
.section-title{font-size:14px;font-weight:600;margin:26px 0 10px;display:flex;justify-content:space-between;align-items:baseline}
.count{font-size:12px;color:var(--muted);font-weight:400}
.picker{display:block;border:1.5px dashed #C9CCCB;border-radius:12px;padding:26px 16px;text-align:center;background:#FAFAF8;cursor:pointer}
.picker:active{background:#F1F1EE}
.picker .plus{font-size:26px;line-height:1}
.picker .label{margin-top:8px;font-size:14px;font-weight:600}
.picker .hint{margin-top:4px;font-size:12px;color:var(--muted)}
.thumbs:empty{display:none}
.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.thumb{position:relative;padding-top:100%;border-radius:8px;overflow:hidden;background:#EDEDEA}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.thumb button{position:absolute;top:4px;right:4px;width:24px;height:24px;border:0;border-radius:50%;
  background:rgba(0,0,0,.6);color:#fff;font-size:14px;line-height:24px;cursor:pointer}
.guide{margin-top:8px}
.guide ol{list-style:none;counter-reset:g}
.guide li{counter-increment:g;display:flex;gap:10px;align-items:flex-start;padding:7px 0;font-size:13.5px}
.guide li::before{content:counter(g);flex:0 0 22px;height:22px;border-radius:50%;background:var(--ink);color:#fff;
  font-size:11px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.field{margin-bottom:14px}
label.f{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
label.f em{font-style:normal;color:var(--muted);font-weight:400;font-size:12px;margin-left:4px}
input[type=text],textarea{width:100%;padding:13px 12px;border:1px solid var(--line);border-radius:8px;
  font-family:inherit;font-size:16px;background:#fff;color:var(--ink);outline:none}
input[type=text]:focus,textarea:focus{border-color:var(--ink)}
textarea{min-height:88px;resize:vertical;line-height:1.6}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.6;
  background:var(--soft);border-radius:10px;padding:14px}
.consent input{margin-top:3px;width:18px;height:18px;flex:0 0 18px}
.privacy{margin-top:10px;font-size:11.5px;color:var(--muted);line-height:1.7}
.submit{width:100%;margin-top:22px;padding:17px;border:0;border-radius:10px;background:var(--accent);color:#fff;
  font-family:inherit;font-size:16px;font-weight:600;cursor:pointer}
.submit:disabled{opacity:.45}
.err{margin-top:14px;padding:12px;border-radius:8px;background:#FDECEA;color:var(--warn);font-size:13px;display:none}
.err.on{display:block}
.progress{display:none;margin-top:14px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.progress.on{display:block}
.progress i{display:block;height:100%;width:0;background:var(--ink);transition:width .2s}
.footer{padding:22px 20px 34px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line);line-height:1.8}
.done{padding:64px 22px;text-align:center}
.done .mark{width:62px;height:62px;border-radius:50%;background:var(--ink);color:#fff;font-size:28px;
  display:flex;align-items:center;justify-content:center;margin:0 auto 22px}
.done h1{font-size:20px;font-weight:600;margin-bottom:12px}
.done p{font-size:14.5px;color:var(--muted);line-height:1.85}
.notice{padding:56px 22px;text-align:center}
.notice h1{font-size:18px;font-weight:600;margin-bottom:10px}
.notice p{font-size:14px;color:var(--muted)}
`;

function shell({ title, body, head = '' }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="format-detection" content="telephone=no">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
${head}
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

function header(subtitle = '시공사례 등록') {
  return `<header><div class="brand">STONEKIM</div><div class="page-title">${escapeHtml(subtitle)}</div></header>`;
}

const GUIDE_SHOTS = [
  '공간 전체 정면',
  '좌측 또는 우측 45도',
  '반대 방향',
  '자재 디테일 (표면·마감)',
  '공간 전체 분위기',
];

/** 고객 사진등록 화면 */
function uploadPage({ project, customer, consentText, privacyText, reward, minPhotos, maxPhotos, error }) {
  const orderRows = [
    ['주문번호', project.order_number],
    ['제품', project.product],
    ['현장', project.site_name],
    ['출고일', project.ship_date],
  ]
    .filter(([, value]) => value)
    .map(([k, v]) => `<div class="order-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`)
    .join('');

  const body = `
${header()}
<main>
  <div class="lead"><b>완성된 공간을 보여주세요.</b></div>
  <div class="sub">등록해주신 사진은 확인 후 리워드를 드립니다.</div>

  <div class="reward">
    <div class="rh">${escapeHtml(reward.headline)}</div>
    <div class="rc">${escapeHtml(reward.criteria)}</div>
  </div>

  <div class="card">
    <h2>${escapeHtml(customer.name)} 고객님 주문내역</h2>
    ${orderRows}
  </div>

  <form id="f" method="post" action="" enctype="multipart/form-data">
    <div class="section-title">사진 등록 <span class="count" id="cnt">0 / ${maxPhotos}장</span></div>
    <label class="picker" for="files" id="picker">
      <div class="plus">＋</div>
      <div class="label">사진 추가</div>
      <div class="hint">최소 ${minPhotos}장 · 최대 ${maxPhotos}장 (여러 장 선택 가능)</div>
    </label>
    <input type="file" id="files" name="photos" accept="image/*,.heic,.heif" multiple style="display:none">
    <div class="thumbs" id="thumbs"></div>

    <div class="card guide" style="margin-top:18px">
      <h2>사진 촬영 가이드</h2>
      <ol>${GUIDE_SHOTS.map((shot) => `<li>${escapeHtml(shot)}</li>`).join('')}</ol>
      <div class="privacy" style="margin-top:6px">전문적으로 촬영하지 않으셔도 됩니다.<br>공간 전체가 잘 보이도록 촬영해주세요.</div>
    </div>

    <div class="section-title">추가 정보</div>
    <div class="field">
      <label class="f" for="region">현장지역</label>
      <input type="text" id="region" name="region" value="${escapeHtml(project.region || '')}" placeholder="예) 서울 강남구" inputmode="text">
    </div>
    <div class="field">
      <label class="f" for="contractor">시공업체명 <em>선택</em></label>
      <input type="text" id="contractor" name="contractor" value="${escapeHtml(project.contractor || '')}">
    </div>
    <div class="field">
      <label class="f" for="sns">인스타그램 / SNS 계정 <em>선택</em></label>
      <input type="text" id="sns" name="sns" value="${escapeHtml(project.sns || '')}" placeholder="@stonekim" autocapitalize="none">
    </div>
    <div class="field">
      <label class="f" for="review_text">간단한 시공후기 <em>선택</em></label>
      <textarea id="review_text" name="review_text" placeholder="사용해보신 느낌을 한두 줄만 남겨주세요.">${escapeHtml(project.review_text || '')}</textarea>
    </div>

    <label class="consent" for="consent">
      <input type="checkbox" id="consent" name="consent" value="1">
      <span>${escapeHtml(consentText)}</span>
    </label>
    <div class="privacy">${escapeHtml(privacyText)}</div>

    <div class="err${error ? ' on' : ''}" id="err">${escapeHtml(error || '')}</div>
    <div class="progress" id="prog"><i></i></div>
    <button type="submit" class="submit" id="go">사진 등록 완료</button>
  </form>
</main>
<div class="footer">
  스톤킴 · 시공사례 리워드 담당<br>
  등록해주신 사진은 확인 후 리워드 대상 여부를 안내드립니다.
</div>
<script>${uploadScript(minPhotos, maxPhotos)}</script>`;

  return shell({ title: 'STONEKIM 시공사례 등록', body });
}

/**
 * 업로드 화면 스크립트.
 * - 선택한 사진을 누적 관리 (사진첩에서 여러 번 나눠 선택 가능)
 * - canvas 로 리사이즈·JPEG 재인코딩 (iOS HEIC 는 브라우저가 디코드 → JPEG 로 변환됨)
 * - 변환 실패 시 원본 그대로 전송하고 서버가 처리
 */
function uploadScript(minPhotos, maxPhotos) {
  return `
(function(){
  var MIN=${minPhotos}, MAX=${maxPhotos}, MAXDIM=1920, Q=0.82;
  var picked=[], input=document.getElementById('files'), thumbs=document.getElementById('thumbs'),
      cnt=document.getElementById('cnt'), form=document.getElementById('f'), err=document.getElementById('err'),
      go=document.getElementById('go'), prog=document.getElementById('prog'), bar=prog.firstElementChild;

  function showErr(m){ err.textContent=m; err.classList.add('on'); err.scrollIntoView({block:'center',behavior:'smooth'}); }
  function clearErr(){ err.classList.remove('on'); }
  function render(){
    thumbs.innerHTML='';
    picked.forEach(function(item,i){
      var d=document.createElement('div'); d.className='thumb';
      var img=document.createElement('img'); img.src=item.url; img.alt='';
      var b=document.createElement('button'); b.type='button'; b.textContent='×'; b.setAttribute('aria-label','삭제');
      b.onclick=function(){ URL.revokeObjectURL(item.url); picked.splice(i,1); render(); };
      d.appendChild(img); d.appendChild(b); thumbs.appendChild(d);
    });
    cnt.textContent=picked.length+' / '+MAX+'장';
  }

  function compress(file){
    return new Promise(function(resolve){
      if(!window.createImageBitmap && !window.FileReader) return resolve(file);
      var url=URL.createObjectURL(file); var img=new Image();
      img.onload=function(){
        try{
          var w=img.naturalWidth, h=img.naturalHeight;
          if(!w||!h){ URL.revokeObjectURL(url); return resolve(file); }
          var scale=Math.min(1, MAXDIM/Math.max(w,h));
          var c=document.createElement('canvas'); c.width=Math.round(w*scale); c.height=Math.round(h*scale);
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          c.toBlob(function(blob){
            URL.revokeObjectURL(url);
            if(!blob || blob.size===0) return resolve(file);
            var name=(file.name||'photo').replace(/\\.[^.]+$/,'')+'.jpg';
            resolve(new File([blob], name, {type:'image/jpeg'}));
          },'image/jpeg',Q);
        }catch(e){ URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror=function(){ URL.revokeObjectURL(url); resolve(file); }; // HEIC 디코드 불가 → 원본 전송
      img.src=url;
    });
  }

  input.addEventListener('change', async function(){
    clearErr();
    var files=Array.prototype.slice.call(input.files||[]);
    input.value='';
    for(var i=0;i<files.length;i++){
      if(picked.length>=MAX){ showErr('사진은 최대 '+MAX+'장까지 등록할 수 있습니다.'); break; }
      var f=files[i];
      if(f.size>20*1024*1024 && !/^image\\//.test(f.type)){ showErr('이미지 파일만 등록할 수 있습니다.'); continue; }
      var out=await compress(f);
      picked.push({file:out, url:URL.createObjectURL(out)});
      render();
    }
  });

  form.addEventListener('submit', function(e){
    if(!picked.length) return; // JS 로 고른 사진이 없으면 기본 폼 전송
    e.preventDefault(); clearErr();
    if(picked.length<MIN){ return showErr('사진은 최소 '+MIN+'장 이상 등록해 주세요.'); }
    if(!document.getElementById('consent').checked){ return showErr('사진 활용 동의에 체크해 주세요.'); }
    var fd=new FormData();
    picked.forEach(function(p){ fd.append('photos', p.file, p.file.name); });
    ['region','contractor','sns','review_text'].forEach(function(k){ fd.append(k, document.getElementById(k).value); });
    fd.append('consent','1');
    go.disabled=true; go.textContent='등록 중...'; prog.classList.add('on');
    var xhr=new XMLHttpRequest();
    xhr.open('POST', form.action || location.href, true);
    xhr.setRequestHeader('X-Requested-With','XMLHttpRequest');
    xhr.upload.onprogress=function(ev){ if(ev.lengthComputable) bar.style.width=Math.round(ev.loaded/ev.total*95)+'%'; };
    xhr.onload=function(){
      bar.style.width='100%';
      var res={}; try{ res=JSON.parse(xhr.responseText); }catch(e){}
      if(xhr.status>=200 && xhr.status<300 && res.ok){ location.href=res.redirect || (location.pathname+'/done'); return; }
      go.disabled=false; go.textContent='사진 등록 완료'; prog.classList.remove('on'); bar.style.width='0';
      showErr(res.error || '등록에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    };
    xhr.onerror=function(){
      go.disabled=false; go.textContent='사진 등록 완료'; prog.classList.remove('on'); bar.style.width='0';
      showErr('네트워크 오류가 발생했습니다. 통신 상태를 확인하고 다시 시도해 주세요.');
    };
    xhr.send(fd);
  });
})();`;
}

/** 제출 완료 화면 */
function donePage({ photoCount, reward }) {
  const body = `
${header()}
<div class="done">
  <div class="mark">✓</div>
  <h1>사진이 정상적으로 등록되었습니다.</h1>
  <p>소중한 시공사진 감사합니다.<br>확인 후 리워드 대상 여부를 안내드리겠습니다.</p>
  ${photoCount ? `<p style="margin-top:18px;font-size:13px">등록된 사진 ${photoCount}장</p>` : ''}
  ${
    reward
      ? `<div class="reward" style="text-align:left;margin:26px 20px 0">
           <div class="rh" style="font-size:13.5px">${escapeHtml(reward.headline)}</div>
           <div class="rc">${escapeHtml(reward.criteria)}</div>
         </div>`
      : ''
  }
</div>`;
  return shell({ title: '등록 완료 · STONEKIM', body });
}

/** 토큰 오류 등 안내 화면 */
function noticePage({ title, message, status = 200 }) {
  const body = `
${header('안내')}
<div class="notice">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
</div>`;
  return { html: shell({ title: `${title} · STONEKIM`, body }), status };
}

module.exports = { uploadPage, donePage, noticePage, shell, BASE_CSS, GUIDE_SHOTS };
