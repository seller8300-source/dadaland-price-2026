"""Domain enumerations shared across models, services and reports."""
from __future__ import annotations

from enum import StrEnum


class TrustStatus(StrEnum):
    """Historical Data Trust Policy (spec §8).

    Every imported row starts as UNVERIFIED. Only rows that pass the
    Data Quality Validator are promoted to TRUSTED.
    """

    UNVERIFIED = "UNVERIFIED"
    TRUSTED = "TRUSTED"
    WARNING = "WARNING"
    REJECTED = "REJECTED"


class DataSource(StrEnum):
    EXCEL_KAYO = "EXCEL_KAYO"       # 케이오마케팅 가공 Excel
    KAYO_RAW = "KAYO_RAW"           # 케이오 RAW export (§32)
    NAVER_API = "NAVER_API"
    MANUAL = "MANUAL"


class ProductCategory(StrEnum):
    """기본 상품군 (spec §10)."""

    COOLING = "냉방"
    HEATING = "난방"
    LOGISTICS = "물류/도크"
    EVENT = "행사/축제"
    KITCHEN = "주방/냉장"
    BEDDING = "침구/이불"
    XMAS_TREE = "크리스마스트리"
    OTHER = "기타"
    UNCLASSIFIED = "미분류"


class ClassificationMethod(StrEnum):
    """분류 우선순위 (spec §10). Lower ``priority`` wins."""

    USER_DICTIONARY = "USER_DICTIONARY"
    EXACT_PRODUCT = "EXACT_PRODUCT"
    RULE_REGEX = "RULE_REGEX"
    AI_SEMANTIC = "AI_SEMANTIC"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    UNRESOLVED = "UNRESOLVED"


CLASSIFICATION_PRIORITY: dict[str, int] = {
    ClassificationMethod.USER_DICTIONARY: 1,
    ClassificationMethod.EXACT_PRODUCT: 2,
    ClassificationMethod.RULE_REGEX: 3,
    ClassificationMethod.AI_SEMANTIC: 4,
    ClassificationMethod.HUMAN_REVIEW: 5,
    ClassificationMethod.UNRESOLVED: 99,
}


class SeasonState(StrEnum):
    """spec §20."""

    OFF_SEASON = "OFF_SEASON"
    PRE_SEASON = "PRE_SEASON"
    RISING = "RISING"
    PEAK = "PEAK"
    DECLINING = "DECLINING"


class SpendDriver(StrEnum):
    """광고비 증가 원인 분해 (spec §12)."""

    A_CLICK_GROWTH = "A_CLICK_GROWTH"
    B_CPC_RISE = "B_CPC_RISE"
    C_CLICK_AND_CPC = "C_CLICK_AND_CPC"
    D_RANK_PUSH = "D_RANK_PUSH"
    E_MARKET_EXPANSION = "E_MARKET_EXPANSION"
    F_CAMPAIGN_EXPANSION = "F_CAMPAIGN_EXPANSION"
    G_NEW_KEYWORDS = "G_NEW_KEYWORDS"
    H_INEFFICIENT_INFLOW = "H_INEFFICIENT_INFLOW"
    NO_MATERIAL_CHANGE = "NO_MATERIAL_CHANGE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class AlertLevel(StrEnum):
    INFO = "INFO"
    WATCH = "WATCH"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AlertType(StrEnum):
    CPC_SPIKE = "CPC_SPIKE"
    CTR_DROP = "CTR_DROP"
    RANK_OVERSPEND = "RANK_OVERSPEND"
    POLICY_VIOLATION = "POLICY_VIOLATION"
    OFF_SEASON_SPEND = "OFF_SEASON_SPEND"
    EFFICIENCY_WARNING = "EFFICIENCY_WARNING"
    DATA_QUALITY = "DATA_QUALITY"
    PRODUCTIVITY_DROP = "PRODUCTIVITY_DROP"
    COMPETITION_REVIEW = "COMPETITION_REVIEW"


class CompetitionPolicy(StrEnum):
    """경쟁 허용 정책 (spec §18–19)."""

    ALLOWED = "ALLOWED"                     # Allowed Competition Spend
    REVIEW = "REVIEW"                       # Reallocation Review Spend
    PRIMARY_ONLY = "PRIMARY_ONLY"
    PRIMARY_PLUS_CHALLENGER = "PRIMARY_PLUS_CHALLENGER"


class ConversionType(StrEnum):
    """STEP 0 전환추적 (spec §7)."""

    QUOTE_REQUEST = "QUOTE_REQUEST"     # 견적문의 완료
    CONSULT_REQUEST = "CONSULT_REQUEST"  # 상담신청
    KAKAO_INQUIRY = "KAKAO_INQUIRY"      # 카카오 문의
    PHONE_CLICK = "PHONE_CLICK"          # 전화 버튼 클릭
    CALL_CONNECTED = "CALL_CONNECTED"    # 실제 통화
    CONTRACT = "CONTRACT"                # 계약
    REVENUE = "REVENUE"                  # 매출


class RecommendationStatus(StrEnum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"          # CEO 승인
    SENT_TO_AGENCY = "SENT_TO_AGENCY"  # 케이오마케팅 전달
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class RecommendationOutcome(StrEnum):
    SUCCESS = "SUCCESS"
    NEUTRAL = "NEUTRAL"
    FAILURE = "FAILURE"
    PENDING = "PENDING"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
