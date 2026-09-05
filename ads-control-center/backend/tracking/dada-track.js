/*!
 * DADA NAVER ADS — 전환추적 스니펫 (STEP 0, §7)
 *
 * 설치:
 *   <script src="https://<control-center>/static/dada-track.js"
 *           data-endpoint="https://<control-center>/api/v1/track/event"
 *           data-account="다다그룹"></script>
 *
 * 수집:
 *   - 최초 유입의 네이버 파라미터(n_keyword/n_query/n_rank/n_ad_group)와 UTM 을 저장 (first touch)
 *   - 견적문의/상담신청 폼 전송, 카카오 문의 클릭, 전화 버튼 클릭
 *   - 실제 통화/계약/매출은 서버 API 로 별도 적재 (통화추적·상담기록 연동)
 *
 * 개인정보: 전화번호 등 식별정보는 전송하지 않는다. 서버는 마스킹된 값만 저장한다.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ENDPOINT = (script && script.getAttribute("data-endpoint")) || "/api/v1/track/event";
  var ACCOUNT = (script && script.getAttribute("data-account")) || null;
  var STORE_KEY = "dada_track_v1";
  var TRACK_PARAMS = [
    "n_keyword", "n_query", "n_ad_group", "n_campaign_type", "n_rank", "n_media", "n_ad",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
  ];

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeStore(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      /* 저장 불가 시에도 이벤트 전송은 계속한다 */
    }
  }

  function currentParams() {
    var query = new URLSearchParams(window.location.search);
    var found = {};
    TRACK_PARAMS.forEach(function (key) {
      var value = query.get(key);
      if (value) found[key] = value;
    });
    return found;
  }

  var store = readStore();
  if (!store.visitor_id) store.visitor_id = uuid();
  if (!store.session_id || Date.now() - (store.session_at || 0) > 30 * 60 * 1000) {
    store.session_id = uuid();
  }
  store.session_at = Date.now();

  var params = currentParams();
  if (Object.keys(params).length) {
    // First touch 를 유지하되, 새 광고 유입이 있으면 최신 광고 파라미터로 갱신한다.
    store.first_touch = store.first_touch || { params: params, url: location.href, at: Date.now() };
    store.last_touch = { params: params, url: location.href, at: Date.now() };
  }
  writeStore(store);

  function attribution() {
    var touch = store.last_touch || store.first_touch || {};
    var p = touch.params || {};
    return {
      keyword_text: p.n_keyword || p.utm_term || null,
      search_term: p.n_query || null,
      campaign_name: p.utm_campaign || null,
      landing_url: touch.url || location.href
    };
  }

  function send(type, extra) {
    var attr = attribution();
    var body = {
      conversion_type: type,
      account_name: ACCOUNT,
      visitor_id: store.visitor_id,
      session_id: store.session_id,
      keyword_text: attr.keyword_text,
      search_term: attr.search_term,
      campaign_name: attr.campaign_name,
      landing_url: attr.landing_url,
      referrer: document.referrer || null,
      device: window.matchMedia("(max-width: 767px)").matches ? "MOBILE" : "PC",
      page_url: location.href
    };
    Object.keys(extra || {}).forEach(function (key) {
      body[key] = extra[key];
    });

    var payload = JSON.stringify(body);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
    } else {
      var request = new XMLHttpRequest();
      request.open("POST", ENDPOINT, true);
      request.setRequestHeader("Content-Type", "application/json");
      request.send(payload);
    }
  }

  // 전화 버튼 클릭 / 카카오 문의 클릭
  document.addEventListener("click", function (event) {
    var anchor = event.target.closest && event.target.closest("a, button");
    if (!anchor) return;
    var href = (anchor.getAttribute("href") || "").toLowerCase();
    var marker = (anchor.getAttribute("data-dada-track") || "").toUpperCase();

    if (marker) {
      send(marker, { lead_id: anchor.getAttribute("data-lead-id") || null });
      return;
    }
    if (href.indexOf("tel:") === 0) {
      send("PHONE_CLICK");
    } else if (href.indexOf("pf.kakao.com") > -1 || href.indexOf("open.kakao.com") > -1) {
      send("KAKAO_INQUIRY");
    }
  }, true);

  // 폼 전송 — data-dada-form="QUOTE_REQUEST" 또는 "CONSULT_REQUEST"
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.getAttribute) return;
    var type = (form.getAttribute("data-dada-form") || "").toUpperCase();
    if (!type) return;
    send(type, { lead_id: form.getAttribute("data-lead-id") || null });
  }, true);

  // 수동 호출용: window.dadaTrack("QUOTE_REQUEST", {lead_id: "..."} )
  window.dadaTrack = send;
})();
