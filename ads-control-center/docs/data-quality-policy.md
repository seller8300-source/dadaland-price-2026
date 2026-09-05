# Historical Data Trust Policy

## 신뢰 상태

| 상태 | 의미 | 분석 사용 |
|---|---|---|
| `UNVERIFIED` | 적재 직후 기본값 | ❌ (집계에서 제외되지는 않지만 승격 전) |
| `TRUSTED` | 검증 통과 | ✅ |
| `WARNING` | 사용 가능하나 주의 (지표 불일치 등) | ✅ (경고 표시) |
| `REJECTED` | 사용 금지 | ❌ 모든 집계에서 제외 |

Excel 에 있다는 이유만으로 사용하지 않습니다. `POST /api/v1/quality/validate` 를 통과해야
`TRUSTED` 로 승격됩니다.

## 검증 규칙

| 규칙 코드 | 판정 | 내용 |
|---|---|---|
| `CROSS_ACCOUNT_ROW_DUPLICATION` | REJECTED | 여러 계정 시트에 동일 행이 복사됨 |
| `CONVERSION_SHEET_UNUSABLE` | REJECTED | 전환수 시트가 계정 간 복제됨 |
| `COST_PATTERN_COPIED_BETWEEN_ACCOUNTS` | REJECTED | 특정 키워드의 일별 비용이 다른 계정과 동일 |
| `TEMPLATE_STRING_IN_VALUE` | REJECTED | 값 자리에 `{{...}}`, `#REF!`, 헤더 문자열이 남음 |
| `CLICKS_EXCEED_IMPRESSIONS` | REJECTED | 클릭 > 노출 (물리적으로 불가능) |
| `COST_WITHOUT_CLICKS` | REJECTED | 클릭 0인데 비용 발생 |
| `NEGATIVE_METRIC` | REJECTED | 음수 지표 |
| `CTR_INCONSISTENT` | WARNING | 기재 CTR ≠ 클릭/노출 |
| `CPC_INCONSISTENT` | WARNING | 기재 CPC ≠ 비용/클릭 |
| `CAMPAIGN_LABEL_MISMATCH` | WARNING | 캠페인 라벨과 키워드 상품군 불일치 |

## 설계상의 판단 두 가지

**1. 계정 전체를 버리지 않습니다.**
비용 복사가 확인되면 해당 **키워드의 행만** 제외하고, 두 계정 모두에 경고를 남깁니다.
어느 쪽이 원본인지 데이터만으로는 알 수 없기 때문입니다. 계정 전체를 버리면
"으라차차는 클릭 확장형인가?" 같은 질문에 아무 답도 할 수 없게 됩니다.

**2. 한쪽 기간에서만 버려진 키워드는 양쪽 기간에서 함께 제외합니다.**
2026년 데이터만 버리고 2025년을 남기면 YoY 비교가 왜곡됩니다. Benchmark 는
문제 키워드를 양쪽에서 빼고 like-for-like 로 비교한 뒤, 제외 사실을 노트에 남깁니다.

## 캠페인명을 믿지 않는 이유

캠페인명은 라벨일 뿐입니다. 실제로 행사 키워드가 물류 캠페인에 들어가 있는 사례가 확인되어,
상품군은 **키워드 문자열**로만 판정합니다(`app/services/classification/`). 캠페인 라벨과
실제 분류가 다르면 `CAMPAIGN_LABEL_MISMATCH` 경고로 남기되, 데이터를 버리지는 않습니다.

## 분류 우선순위

1. 사용자 정의 키워드 사전 (confidence 100)
2. 정확한 상품명 패턴 (88~95)
3. 정규식/Rule (70~75)
4. AI 의미분류 (모델이 붙는 경우, confidence 저장 / 70 미만은 사람 검토)
5. 사람 검토 대기 (`미분류`, confidence 0)

분류가 안 되면 억지로 채우지 않고 `미분류 + needs_human_review` 로 남깁니다.
정책위반 판정에서도 `미분류`/`기타` 는 위반으로 보지 않습니다 — 분류 실패를 위반으로
오인하면 안 되기 때문입니다.
