"""Opportunity Engine (§16–17) — 근거 없는 추천을 만들지 않는다."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.demo import dataset as synthetic
from app.services.opportunity import engine

AS_OF = date(2026, 8, 31)


def test_every_candidate_has_at_least_two_evidences(seeded_db: Session) -> None:
    candidates = engine.generate(seeded_db, AS_OF)
    assert candidates
    assert all(len(c.evidence) >= engine.MIN_EVIDENCE_COUNT for c in candidates)


def test_search_term_opportunities_are_not_already_registered(seeded_db: Session) -> None:
    """이미 어느 계정에 세팅된 키워드는 '미세팅 기회' 가 아니다."""
    from app.models import Keyword

    registered = {k.normalized_text for k in seeded_db.query(Keyword).all()}
    candidates = engine.generate(seeded_db, AS_OF)
    from app.services.classification.dictionary import normalize

    assert all(normalize(c.keyword_text) not in registered for c in candidates)


def test_venue_search_terms_become_event_opportunities(seeded_db: Session) -> None:
    candidates = {c.keyword_text: c for c in engine.generate(seeded_db, AS_OF)}
    assert "코엑스 냉장고렌탈" in candidates
    candidate = candidates["코엑스 냉장고렌탈"]
    assert candidate.opportunity_type == "NEW_KEYWORD"
    assert any(e.code == "SEARCH_TERM_REPEAT" for e in candidate.evidence)
    assert any(e.code == "HIGH_INTENT_STRUCTURE" for e in candidate.evidence)


def test_region_expansion_requires_proven_performance(db: Session) -> None:
    """성과 근거가 없으면 지역 조합을 무작정 만들지 않는다 (§16)."""
    synthetic.generate(db)  # 검증 전이므로 신뢰 데이터 없음
    from app.services.quality.validator import validate

    validate(db)
    candidates = engine.region_expansion(db, date(2026, 1, 1), AS_OF)
    assert candidates, "성과가 확인된 지역 조합에서는 확장 후보가 나와야 한다."
    for candidate in candidates:
        assert candidate.opportunity_type == "REGION"
        assert any(e.code == "SIMILAR_KEYWORD_PERFORMANCE" for e in candidate.evidence)


def test_ceo_report_filter_drops_low_confidence() -> None:
    low = engine.OpportunityCandidate(
        keyword_text="테스트키워드",
        opportunity_type="NEW_KEYWORD",
        product_category="냉방",
        evidence=[engine.Evidence("A", "근거1", 30.0), engine.Evidence("B", "근거2", 30.0)],
    )
    high = engine.OpportunityCandidate(
        keyword_text="확실한키워드",
        opportunity_type="NEW_KEYWORD",
        product_category="냉방",
        evidence=[engine.Evidence("A", "근거1", 40.0), engine.Evidence("B", "근거2", 35.0)],
    )
    assert low.confidence == 60.0 and high.confidence == 75.0
    shown = engine.for_ceo_report([low, high])
    assert [item["keyword"] for item in shown] == ["확실한키워드"]


def test_single_evidence_scores_zero() -> None:
    """근거가 1개뿐이면 점수를 만들지 않는다 (§17, §40)."""
    candidate = engine.OpportunityCandidate(
        keyword_text="근거부족키워드",
        opportunity_type="NEW_KEYWORD",
        product_category="냉방",
        evidence=[engine.Evidence("A", "근거1", 90.0)],
    )
    assert candidate.confidence == 0.0
