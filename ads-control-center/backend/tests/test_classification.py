"""상품군 분류 (§10) — 캠페인명이 아니라 키워드 문자열이 기준이다."""
from __future__ import annotations

import pytest

from app.core.enums import ClassificationMethod, ProductCategory
from app.services.classification.classifier import (
    classify_keyword,
    extract_intent_signals,
    keyword_family_root,
)


@pytest.mark.parametrize(
    "keyword,expected",
    [
        ("코끼리에어컨", ProductCategory.COOLING),
        ("이동식에어컨렌탈", ProductCategory.COOLING),
        ("산업용제습기", ProductCategory.COOLING),
        ("난방기렌탈", ProductCategory.HEATING),
        ("이동식도크임대", ProductCategory.LOGISTICS),
        ("롤테이너대여", ProductCategory.LOGISTICS),
        ("업소용냉장고", ProductCategory.KITCHEN),
        ("코엑스 냉장고렌탈", ProductCategory.KITCHEN),
        ("이불렌탈", ProductCategory.BEDDING),
        ("크리스마스트리대여", ProductCategory.XMAS_TREE),
        ("박람회 부스렌탈", ProductCategory.EVENT),
    ],
)
def test_keyword_text_decides_category(keyword: str, expected: str) -> None:
    assert classify_keyword(keyword).category == expected


def test_unknown_keyword_is_not_guessed() -> None:
    """근거가 없으면 추측하지 않고 사람 검토로 넘긴다 (§40)."""
    result = classify_keyword("의미없는말입니다")
    assert result.category == ProductCategory.UNCLASSIFIED
    assert result.method == ClassificationMethod.UNRESOLVED
    assert result.confidence == 0.0
    assert result.needs_human_review is True


def test_user_dictionary_wins_over_pattern() -> None:
    result = classify_keyword("업소용냉장고")
    assert result.method == ClassificationMethod.USER_DICTIONARY
    assert result.confidence == 100.0


def test_high_intent_structure_detected() -> None:
    """지역 + 상품 + 렌탈 = 보호해야 할 고의도 키워드 (§15)."""
    result = classify_keyword("인천 이동식에어컨렌탈")
    assert result.region == "인천"
    assert result.is_high_intent is True


def test_venue_keyword_detected() -> None:
    signals = extract_intent_signals("코엑스 냉장고렌탈")
    assert signals["venue"] == "코엑스"
    assert signals["rental"] is True


def test_keyword_family_root_groups_variants() -> None:
    """대표키워드와 파생표현을 같은 Family 로 묶는다 (§14)."""
    roots = {
        keyword_family_root(k)
        for k in ("코끼리에어컨", "코끼리에어컨렌탈", "코끼리에어컨대여", "코끼리에어컨임대")
    }
    assert roots == {"코끼리에어컨"}
