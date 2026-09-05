"""Data Quality 규칙 정의 (§9).

이미 확인된 케이오 Excel 의 구조적 문제를 규칙으로 고정한다.
규칙은 '이 데이터를 분석에 쓸 수 있는가' 만 판단한다 — 광고 자체를 평가하지 않는다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

BLOCKING = "REJECTED"
NON_BLOCKING = "WARNING"


@dataclass(slots=True)
class Finding:
    rule_code: str
    severity: str
    scope: str
    message: str
    evidence: dict = field(default_factory=dict)
    account_ids: list[int] = field(default_factory=list)
    import_ids: list[int] = field(default_factory=list)

    @property
    def blocks_analysis(self) -> bool:
        return self.severity == BLOCKING


# 템플릿 문자열 흔적 (§9 '키워드 상세' 평균순위/품질지수/전환 영역)
TEMPLATE_PATTERNS = (
    re.compile(r"\{\{.*?\}\}"),
    re.compile(r"\$\{.*?\}"),
    re.compile(r"#REF!|#N/A|#VALUE!|#DIV/0!", re.IGNORECASE),
    re.compile(r"^(?:xx+|--+|__+|템플릿|샘플|sample|dummy|미정)$", re.IGNORECASE),
    re.compile(r"^(?:평균순위|품질지수|전환수)$"),  # 값 자리에 헤더가 복사된 경우
)

TEMPLATE_SENSITIVE_COLUMNS = ("평균순위", "평균노출순위", "품질지수", "전환수", "전환", "순위")

RULE_DESCRIPTIONS: dict[str, str] = {
    "CROSS_ACCOUNT_ROW_DUPLICATION": "여러 계정에 동일한 행 데이터가 복사되어 있음 (§9 전환수/쇼핑검색 상세)",
    "TEMPLATE_STRING_IN_VALUE": "값 영역에 템플릿 문자열이 남아 있음 (§9 키워드 상세)",
    "COST_PATTERN_COPIED_BETWEEN_ACCOUNTS": "키워드 비용값이 다른 계정과 동일 패턴으로 복사됨 (§9 으라차차)",
    "CAMPAIGN_LABEL_MISMATCH": "키워드 상품군과 캠페인 라벨이 불일치 (§9 캠페인 라벨 오류)",
    "CLICKS_EXCEED_IMPRESSIONS": "클릭수가 노출수보다 큼 — 물리적으로 불가능",
    "COST_WITHOUT_CLICKS": "클릭 0 인데 비용이 발생",
    "CTR_INCONSISTENT": "기재된 CTR 이 클릭/노출과 일치하지 않음",
    "CPC_INCONSISTENT": "기재된 CPC 가 비용/클릭과 일치하지 않음",
    "CONVERSION_SHEET_UNUSABLE": "전환수 시트가 계정 간 복제되어 분석 사용 금지 (§9)",
    "NEGATIVE_METRIC": "음수 지표",
}


def has_template_string(value: object) -> bool:
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in TEMPLATE_PATTERNS)


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
