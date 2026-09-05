# DADA NAVER ADS AI CONTROL CENTER

네이버 검색광고 10개 계정을 **회사 전체 관점**에서 통합 관리하는 AI 광고총괄 시스템입니다.

이 시스템은 "광고비를 적게 쓰게 하는 AI" 가 아닙니다.

> 돈이 되는 광고에는 더 쓰고, 돈이 되지 않는 광고는 줄이고,
> 아직 발견하지 못한 수요는 먼저 찾아내는 AI.

모든 추천에는 데이터 근거를 표시하고, 근거가 부족하면 추측하지 않고 **DATA INSUFFICIENT** 라고 명시합니다.

---

## 지금 구현된 범위 (MVP STEP 0 ~ 6)

| STEP | 내용 | 위치 |
|---|---|---|
| STEP 0 | 전환추적 세팅 | `backend/tracking/dada-track.js`, `app/services/conversion/`, `POST /api/v1/track/*` |
| STEP 1 | 케이오 Excel Import | `app/services/importer/`, `POST /api/v1/imports` |
| STEP 2 | Data Quality Validator | `app/services/quality/`, `POST /api/v1/quality/validate` |
| STEP 3 | 2025/2026 Benchmark | `app/services/benchmark/`, `GET /api/v1/benchmark/yoy` |
| STEP 4 | NAVER Search Ad API 연결 (READ ONLY) | `app/services/naver/`, `GET /api/v1/naver/status` |
| STEP 5 | Keyword Competition Measurement | `app/services/competition/`, `GET /api/v1/competition` |
| STEP 6 | 회사/팀 Daily Report | `app/services/reporting/`, `GET /api/v1/reports/daily` |

부가 구현: 매출 생산성 · 손익분기 시나리오(§25–26), 시즌 판정(§20–21), Opportunity 엔진(§16–17),
추천 효과 추적(§29), 정책위반 탐지(§6), 주간 리포트(§28).

---

## 빠르게 실행하기

```bash
cp .env.example .env          # DB/네이버 자격증명 입력 (시크릿은 코드에 넣지 않습니다)
docker compose up --build     # backend :8000 / frontend :3000 / postgres :5432
```

로컬 개발(파이썬만):

```bash
cd backend
pip install -r requirements-dev.txt
export DATABASE_URL="postgresql+psycopg://dada:dada@localhost:5432/dada_ads"
uvicorn app.main:app --reload        # http://localhost:8000/docs
```

초기 데이터 세팅:

```bash
curl -X POST localhost:8000/api/v1/seed                 # 계정 10개 · 상품군 · 운영규칙
curl -X POST localhost:8000/api/v1/imports \
     -H 'content-type: application/json' \
     -d '{"path": "/data"}'                             # 케이오 Excel 디렉터리 적재 (UNVERIFIED)
curl -X POST localhost:8000/api/v1/quality/validate     # 검증 → TRUSTED 승격
curl "localhost:8000/api/v1/reports/daily.txt"          # 오늘의 CEO 리포트
```

실제 Excel 이 오기 전에 시스템만 먼저 확인하고 싶다면 (§38 검증 데이터셋 적재):

```bash
cd backend
python -m app.cli demo --with-defects     # 2025/2026 1~8월 합성 데이터 + 알려진 Excel 결함 재현
python -m app.cli daily 2026-08-31        # 리포트 확인
```

운영 CLI:

```bash
python -m app.cli init-db | seed | import <경로> | validate | daily [날짜] | weekly [날짜] | sync-naver
```

테스트:

```bash
cd backend && python -m pytest         # 109 tests
```

---

## 설계 원칙 (코드에 그대로 반영되어 있습니다)

1. **광고비 증가 = 비효율이 아니다.** 항상 매출·기여이익 증가율과 함께 평가합니다.
   `app/services/productivity/revenue.py`
2. **Excel 에 있다고 믿지 않는다.** 모든 적재 데이터는 `UNVERIFIED` 로 시작하고,
   검증을 통과해야 `TRUSTED` 가 됩니다. `app/services/quality/validator.py`
3. **캠페인명은 상품분류의 Source of Truth 가 아니다.** 상품군은 키워드 문자열로 판정하고,
   캠페인 라벨 불일치는 별도 경고로 남깁니다. `app/services/classification/`
4. **중복 광고 = 낭비가 아니다.** 시장규모·시즌·운영정책을 반영해
   *Allowed Competition Spend* 와 *Reallocation Review Spend* 를 분리합니다.
   `app/services/competition/measure.py`
5. **AI 는 광고를 직접 바꾸지 않는다.** NAVER API 는 READ ONLY 이며, 쓰기 요청은 예외를 던집니다.
   `DATA → AI 분석 → CEO 승인 → 케이오마케팅 실행`. `app/services/naver/client.py`
6. **근거 없는 추천을 만들지 않는다.** 신규 키워드 추천은 근거 2개 이상이어야 하고,
   Confidence 70점 미만은 CEO 보고서에서 제외합니다. `app/services/opportunity/engine.py`

금지된 단정(§11 — 광고비 많음=나쁜 광고, CPC 낮음=좋은 광고 등)은 어떤 모듈에서도 하드코딩된
판정으로 쓰이지 않습니다. 모든 플래그는 "무엇을 먼저 확인할지" 의 우선순위입니다.

---

## 문서

- [`docs/step0-conversion-tracking.md`](docs/step0-conversion-tracking.md) — 전환추적 설치 가이드 (가장 먼저 할 일)
- [`docs/kayo-raw-data-request.md`](docs/kayo-raw-data-request.md) — 케이오마케팅 RAW 데이터/2025 원본 재발행 요청문
- [`docs/data-quality-policy.md`](docs/data-quality-policy.md) — 신뢰도 정책과 이미 확인된 Excel 결함
- [`docs/analysis-guide.md`](docs/analysis-guide.md) — 계정별 Benchmark 해석과 AI 운영원칙

---

## 검증 테스트 (§38)

과거 데이터를 넣었을 때 다음 패턴이 재현되지 않으면 Import 또는 분석로직부터 재검증합니다.
`backend/tests/test_verification_38.py` 가 이를 자동으로 확인합니다.

| 계정 | 재현되어야 하는 결과 |
|---|---|
| 마니 | CPC 급등(+153%) + CTR 급락(-65%) → `EFFICIENCY_WARNING` |
| MBC렌탈 | CPC 상승 + CTR 하락 → `CPC_UP_CTR_DOWN` |
| 킴샵 | 비용 증가보다 클릭 증가가 큰 확대형 → `EXPANSION_TYPE` |
| 으라차차 | 클릭 확장형 + Excel 데이터 오류 경고 → `CLICK_EXPANSION` + `DATA_QUALITY_BLOCKED` |
| 빌리마켓 | 상대적 저CPC → `LOW_CPC_ACCOUNT` |
| OMBC | Slow-growth 최대 Volume + 이불 Primary |
| 다있지 | 냉방 효율 Benchmark 후보(CPC 2,427 / CTR 6.89%) + 1위 고정운영 경고 |
| 현대도크 | 물류 외 광고 `POLICY_VIOLATION` |
| 타임렌탈 | 매출 성장계정 + 지역키워드 Benchmark |
| 다다그룹 | 매출 성장계정 별도 평가 |

회사 전체 기준선도 함께 검증합니다: 2025년 1~8월 64,476,115원 / 52,313클릭,
2026년 1~8월 170,957,879원 / 93,819클릭 (광고비 +165%, 클릭 +79%, CPC +48%).

---

## 아직 하지 않은 것 (V2 / V3)

- V2: 실제 검색어 심층 분석, 소재 스코어링 자동화, 랜딩페이지 크롤링 분석, 매출 시스템 연동
- V3: 장기 시즌 예측 고도화, Event Opportunity 자동 수집(코엑스/킨텍스 등 행사 캘린더 크롤링),
  지역 Opportunity 확장, 장기 AI 최적화

현재 코드에는 이 영역의 **데이터 모델과 인터페이스**가 준비되어 있고(테이블 `events`,
`creatives`, `landing_pages`, `opportunities`), 채워 넣는 작업만 남아 있습니다.
