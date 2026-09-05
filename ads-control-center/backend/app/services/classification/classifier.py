"""상품군 분류기 (§10).

분류 우선순위:
    1. 사용자 정의 키워드 사전
    2. 정확한 상품명 패턴
    3. 정규식/Rule
    4. AI 의미분류 (플러그인. 미설정 시 호출되지 않는다)
    5. 사람이 미분류 검토

AI 분류 결과에는 Confidence Score 를 저장한다. 근거가 부족하면 추측하지 않고
UNCLASSIFIED + needs_human_review 로 남긴다 (§40 DATA INSUFFICIENT).
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from app.core.enums import ClassificationMethod, ProductCategory
from app.services.classification.dictionary import (
    NORMALIZED_USER_DICTIONARY,
    PRODUCT_TERMS,
    REGIONS,
    RENTAL_TERMS,
    SHORT_TERM_TERMS,
    USE_TERMS,
    VENUES,
    normalize,
)

# 3순위 규칙: (정규식, 상품군, confidence)
RULE_PATTERNS: list[tuple[re.Pattern[str], str, float]] = [
    (re.compile(r"(냉방|쿨링|시원)"), ProductCategory.COOLING, 72.0),
    (re.compile(r"(난방|온열|따뜻)"), ProductCategory.HEATING, 72.0),
    (re.compile(r"(물류|하역|상하차|적재)"), ProductCategory.LOGISTICS, 72.0),
    (re.compile(r"(행사|축제|박람|전시|페어|컨벤션|웨딩|돌잔치)"), ProductCategory.EVENT, 70.0),
    (re.compile(r"(주방|급식|카페|푸드|식자재)"), ProductCategory.KITCHEN, 70.0),
    (re.compile(r"(침구|이불|숙박|게스트하우스)"), ProductCategory.BEDDING, 70.0),
    (re.compile(r"(크리스마스|성탄)"), ProductCategory.XMAS_TREE, 75.0),
]

_SORTED_PRODUCT_TERMS: list[tuple[str, str]] = sorted(
    ((normalize(term), category) for category, terms in PRODUCT_TERMS.items() for term in terms),
    key=lambda pair: len(pair[0]),
    reverse=True,
)

AiClassifier = Callable[[str], tuple[str, float] | None]


@dataclass(slots=True)
class ClassificationResult:
    raw_text: str
    normalized_text: str
    category: str
    method: str
    confidence: float
    matched_rule: str | None = None
    region: str | None = None
    venue: str | None = None
    intent_signals: dict = field(default_factory=dict)
    needs_human_review: bool = False

    @property
    def is_high_intent(self) -> bool:
        """검색량이 적어도 보호해야 하는 고의도 구조인가 (§15)."""
        s = self.intent_signals
        return bool(
            s.get("rental")
            and (s.get("region") or s.get("venue") or s.get("event") or s.get("use") or s.get("short_term"))
        )


def _detect(text_norm: str, candidates: tuple[str, ...]) -> str | None:
    hit = None
    for candidate in candidates:
        c = normalize(candidate)
        if c and c in text_norm and (hit is None or len(c) > len(normalize(hit))):
            hit = candidate
    return hit


def extract_intent_signals(raw_text: str) -> dict:
    """검색의도 신호 추출 (§15, §16, §18의 Intent Cluster 재료)."""
    norm = normalize(raw_text)
    region = _detect(norm, REGIONS)
    venue = _detect(norm, VENUES)
    rental = any(normalize(t) in norm for t in RENTAL_TERMS)
    short_term = any(normalize(t) in norm for t in SHORT_TERM_TERMS)
    use = _detect(norm, USE_TERMS)
    event = bool(re.search(r"(행사|축제|박람|전시|페어|콘서트|웨딩)", raw_text)) or bool(venue)
    return {
        "rental": rental,
        "region": region,
        "venue": venue,
        "use": use,
        "short_term": short_term,
        "event": event,
    }


def classify_keyword(raw_text: str, ai_classifier: AiClassifier | None = None) -> ClassificationResult:
    """키워드 문자열 하나를 상품군으로 분류한다."""
    norm = normalize(raw_text)
    signals = extract_intent_signals(raw_text)
    base = dict(
        raw_text=raw_text,
        normalized_text=norm,
        region=signals.get("region"),
        venue=signals.get("venue"),
        intent_signals=signals,
    )

    if not norm:
        return ClassificationResult(
            **base,
            category=ProductCategory.UNCLASSIFIED,
            method=ClassificationMethod.UNRESOLVED,
            confidence=0.0,
            needs_human_review=True,
        )

    # 1. 사용자 정의 사전 (정확 일치)
    if norm in NORMALIZED_USER_DICTIONARY:
        return ClassificationResult(
            **base,
            category=NORMALIZED_USER_DICTIONARY[norm],
            method=ClassificationMethod.USER_DICTIONARY,
            confidence=100.0,
            matched_rule=norm,
        )

    # 2. 정확한 상품명 패턴 (가장 긴 상품명이 우선 — '업소용냉장고' > '냉장고')
    for term, category in _SORTED_PRODUCT_TERMS:
        if term and term in norm:
            confidence = 95.0 if len(term) >= 4 else 88.0
            return ClassificationResult(
                **base,
                category=category,
                method=ClassificationMethod.EXACT_PRODUCT,
                confidence=confidence,
                matched_rule=term,
            )

    # 3. 정규식 / Rule
    for pattern, category, confidence in RULE_PATTERNS:
        if pattern.search(raw_text):
            return ClassificationResult(
                **base,
                category=category,
                method=ClassificationMethod.RULE_REGEX,
                confidence=confidence,
                matched_rule=pattern.pattern,
            )

    # 4. AI 의미분류 (선택). 신뢰도가 낮으면 사람 검토로 넘긴다.
    if ai_classifier is not None:
        guess = ai_classifier(raw_text)
        if guess:
            category, confidence = guess
            return ClassificationResult(
                **base,
                category=category,
                method=ClassificationMethod.AI_SEMANTIC,
                confidence=float(confidence),
                matched_rule="ai",
                needs_human_review=confidence < 70,
            )

    # 5. 사람 검토 대기
    return ClassificationResult(
        **base,
        category=ProductCategory.UNCLASSIFIED,
        method=ClassificationMethod.UNRESOLVED,
        confidence=0.0,
        needs_human_review=True,
    )


def keyword_family_root(raw_text: str) -> str | None:
    """Keyword Family 루트 추출 (§14).

    '코끼리에어컨렌탈' / '코끼리에어컨대여' → '코끼리에어컨'.
    파생 표현(렌탈/대여/임대)과 지역 접두를 제거한 형태를 루트로 본다.
    AI 는 어떤 표현이 낫다고 미리 가정하지 않는다 — 루트는 비교 단위일 뿐이다.
    """
    norm = normalize(raw_text)
    if not norm:
        return None
    for term in sorted((normalize(t) for t in RENTAL_TERMS), key=len, reverse=True):
        if norm.endswith(term):
            norm = norm[: -len(term)]
            break
    for region in sorted((normalize(r) for r in REGIONS), key=len, reverse=True):
        if region and norm.startswith(region) and len(norm) > len(region) + 1:
            norm = norm[len(region) :]
            break
    return norm or None
