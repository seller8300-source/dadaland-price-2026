# STEP 0 — 전환추적 설치 가이드

전환 데이터는 **설치한 순간부터** 쌓입니다. 다른 개발이 끝나기를 기다리지 않고 가장 먼저 세팅합니다.

목표 체인:

```
KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE
```

## 1. 웹 스니펫 설치

각 계정의 랜딩페이지(자사몰/랜딩/블로그 랜딩 포함) `</body>` 앞에 넣습니다.

```html
<script src="https://<control-center>/static/dada-track.js"
        data-endpoint="https://<control-center>/api/v1/track/event"
        data-account="다다그룹"></script>
```

스니펫이 자동으로 수집하는 것:

| 이벤트 | 트리거 |
|---|---|
| `PHONE_CLICK` | `href="tel:..."` 클릭 |
| `KAKAO_INQUIRY` | `pf.kakao.com` / `open.kakao.com` 링크 클릭 |
| `QUOTE_REQUEST` | `<form data-dada-form="QUOTE_REQUEST">` 전송 |
| `CONSULT_REQUEST` | `<form data-dada-form="CONSULT_REQUEST">` 전송 |
| 임의 이벤트 | `<a data-dada-track="QUOTE_REQUEST">` 또는 `window.dadaTrack("QUOTE_REQUEST")` |

스니펫은 최초 유입의 `n_keyword` / `n_query` / `n_rank` / UTM 파라미터를 저장했다가
나중에 발생한 전환에 붙입니다. 개인정보(전화번호 원문 등)는 전송하지 않습니다.

## 2. 전화 문의 연결 (렌탈에서 가장 중요)

렌탈은 전화문의 비중이 커서 웹 전환만으로는 부족합니다. 두 가지를 병행합니다.

1. **전화 버튼 클릭** — 스니펫이 자동 수집 (`PHONE_CLICK`)
2. **실제 통화** — 통화추적 서비스 또는 상담기록 시스템에서 서버로 전송

```bash
curl -X POST https://<control-center>/api/v1/track/call \
  -H 'content-type: application/json' \
  -d '{
        "account_name": "타임렌탈",
        "occurred_at": "2026-07-02T09:05:00+09:00",
        "visitor_id": "<웹에서 받은 visitor_id 또는 통화추적 번호 매칭 키>",
        "phone_number_masked": "010-****-1234",
        "call_seconds": 183,
        "lead_id": "CRM-10231"
      }'
```

`visitor_id` 또는 `lead_id` 가 이어지면 직전 광고 유입의 키워드를 상속합니다
(`attribution_method = PREVIOUS_TOUCH`). 이어지지 않으면 **추측하지 않고**
`UNATTRIBUTED` 로 남깁니다.

## 3. 견적 → 계약 → 매출 연결

같은 `lead_id` 로 후속 이벤트를 보냅니다.

```bash
# 견적 발송
curl -X POST .../api/v1/track/event -H 'content-type: application/json' \
  -d '{"conversion_type":"QUOTE_REQUEST","lead_id":"CRM-10231","account_name":"타임렌탈"}'

# 계약 (금액 포함)
curl -X POST .../api/v1/track/event -H 'content-type: application/json' \
  -d '{"conversion_type":"CONTRACT","lead_id":"CRM-10231","account_name":"타임렌탈","value":2400000}'
```

매출 집계는 별도로 일 단위 연동도 가능합니다.

```bash
curl -X POST .../api/v1/sales -H 'content-type: application/json' \
  -d '{"account_name":"타임렌탈","sale_date":"2026-07-31","revenue":48000000,"contribution_profit":14400000}'
```

## 4. 설치 상태 확인

```bash
curl "localhost:8000/api/v1/track/coverage"   # 계정별 설치 여부, 미귀속 이벤트 수
curl "localhost:8000/api/v1/track/funnel"     # 클릭 → 문의 → 견적 → 계약 → 매출
```

전환 이벤트가 하나도 없으면 퍼널은 숫자를 지어내지 않고
`DATA INSUFFICIENT — 전환 이벤트가 아직 수집되지 않았습니다.` 를 반환합니다.

## 5. 왜 지금인가

전환 데이터가 붙기 전까지는 다음 판단을 **확정하지 않습니다**.

- 어느 계정이 냉방 효율 Benchmark 인지 (다있지는 현재 "후보" 상태)
- 동일 키워드를 여러 팀이 운영할 때 어느 계정에 남길지
- 메인키워드의 순위를 낮춰도 되는지 (1.2위 vs 3.1위의 전환 차이)

그래서 STEP 0 이 가장 먼저입니다.
