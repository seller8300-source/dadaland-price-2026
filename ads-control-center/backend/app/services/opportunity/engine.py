"""Keyword Opportunity Engine (§16–17).

현재 어느 계정에도 없는 유망 키워드를 추천한다.
단, 반드시 Data Evidence 가 있어야 하며 **최소 2개 이상** 이어야 한다.
근거가 부족하면 만들어내지 않는다 (§40 DATA INSUFFICIENT).
Confidence 70점 미만은 CEO 보고서에서 제외한다 (§17).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Event, Keyword, KeywordStatDaily, Opportunity, SearchTerm
from app.services.classification.classifier import classify_keyword, extract_intent_signals
from app.services.classification.dictionary import normalize
from app.services.quality.validator import trusted_stats_filter

MIN_EVIDENCE_COUNT = 2
SEARCH_TERM_MIN_OCCURRENCES = 3
SEARCH_TERM_MIN_CLICKS = 2


@dataclass(slots=True)
class Evidence:
    code: str
    detail: str
    weight: float

    def as_dict(self) -> dict:
        return {"code": self.code, "detail": self.detail, "weight": self.weight}


@dataclass(slots=True)
class OpportunityCandidate:
    keyword_text: str
    opportunity_type: str
    product_category: str | None
    region: str | None = None
    event_id: int | None = None
    suggested_account_id: int | None = None
    estimated_cpc: float | None = None
    estimated_monthly_volume: int | None = None
    evidence: list[Evidence] = field(default_factory=list)

    @property
    def confidence(self) -> float:
        """근거 가중치 합. 근거 2개 미만이면 0점 — 추측으로 점수를 만들지 않는다."""
        if len(self.evidence) < MIN_EVIDENCE_COUNT:
            return 0.0
        return min(100.0, sum(e.weight for e in self.evidence))

    def as_dict(self) -> dict:
        return {
            "keyword": self.keyword_text,
            "type": self.opportunity_type,
            "product_category": self.product_category,
            "region": self.region,
            "estimated_cpc": self.estimated_cpc,
            "confidence": round(self.confidence, 1),
            "evidence": [e.as_dict() for e in self.evidence],
            "evidence_count": len(self.evidence),
        }


def _registered_keywords(db: Session) -> set[str]:
    return {row for row in db.scalars(select(Keyword.normalized_text)) if row}


def _category_cpc(db: Session, start: date, end: date) -> dict[str, float]:
    rows = db.execute(
        select(
            KeywordStatDaily.product_category,
            func.sum(KeywordStatDaily.cost),
            func.sum(KeywordStatDaily.clicks),
        )
        .where(
            and_(
                KeywordStatDaily.stat_date >= start,
                KeywordStatDaily.stat_date <= end,
                trusted_stats_filter(),
            )
        )
        .group_by(KeywordStatDaily.product_category)
    ).all()
    return {
        category: float(cost or 0.0) / int(clicks)
        for category, cost, clicks in rows
        if category and clicks
    }


def from_search_terms(db: Session, start: date, end: date) -> list[OpportunityCandidate]:
    """실제 검색어에서 미세팅 키워드를 찾는다 (§17 근거 1: 실제 검색어 반복)."""
    rows = db.execute(
        select(
            SearchTerm.normalized_text,
            func.min(SearchTerm.text),
            func.count(SearchTerm.id),
            func.sum(SearchTerm.clicks),
            func.sum(SearchTerm.cost),
            func.sum(SearchTerm.conversions),
        )
        .where(and_(SearchTerm.stat_date >= start, SearchTerm.stat_date <= end))
        .group_by(SearchTerm.normalized_text)
    ).all()

    registered = _registered_keywords(db)
    category_cpc = _category_cpc(db, start, end)
    candidates: list[OpportunityCandidate] = []

    for norm, text, occurrences, clicks, cost, conversions in rows:
        if not norm or norm in registered:
            continue
        occurrences = int(occurrences or 0)
        clicks = int(clicks or 0)
        if occurrences < SEARCH_TERM_MIN_OCCURRENCES or clicks < SEARCH_TERM_MIN_CLICKS:
            continue

        classification = classify_keyword(text)
        signals = extract_intent_signals(text)
        evidence = [
            Evidence(
                "SEARCH_TERM_REPEAT",
                f"실제 검색어로 {occurrences}일 반복 유입 (클릭 {clicks})",
                40.0,
            )
        ]
        if signals["rental"] and (signals["region"] or signals["venue"] or signals["use"] or signals["short_term"]):
            evidence.append(
                Evidence("HIGH_INTENT_STRUCTURE", "지역/용도 + 상품 + 렌탈 구조의 고의도 검색어", 25.0)
            )
        if conversions:
            evidence.append(Evidence("CONVERTED", f"검색어 기준 전환 {int(conversions)}건 발생", 30.0))

        observed_cpc = (float(cost or 0.0) / clicks) if clicks else None
        benchmark_cpc = category_cpc.get(classification.category)
        if observed_cpc and benchmark_cpc and observed_cpc <= benchmark_cpc * 0.8:
            evidence.append(
                Evidence(
                    "LOW_EXPECTED_CPC",
                    f"관측 CPC {observed_cpc:,.0f}원 < 상품군 평균 {benchmark_cpc:,.0f}원",
                    20.0,
                )
            )
        if classification.confidence >= 88:
            evidence.append(
                Evidence("CATEGORY_CONFIDENT", f"상품군 분류 신뢰도 {classification.confidence:.0f}", 10.0)
            )

        candidates.append(
            OpportunityCandidate(
                keyword_text=text,
                opportunity_type="NEW_KEYWORD",
                product_category=classification.category,
                region=classification.region,
                estimated_cpc=round(observed_cpc, 1) if observed_cpc else None,
                evidence=evidence,
            )
        )
    return candidates


def region_expansion(db: Session, start: date, end: date, top_n: int = 40) -> list[OpportunityCandidate]:
    """지역키워드 엔진 (§16).

    이미 성과가 검증된 '지역 + 상품 + 렌탈' 조합을 근거로, 같은 상품의
    다른 지역 조합 중 아직 세팅되지 않은 것만 제안한다.
    근거 없는 조합은 무작정 생성하지 않는다.
    """
    rows = db.execute(
        select(
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.product_category,
            func.sum(KeywordStatDaily.clicks),
            func.sum(KeywordStatDaily.cost),
            func.sum(KeywordStatDaily.impressions),
            func.sum(KeywordStatDaily.conversions),
        )
        .where(
            and_(
                KeywordStatDaily.stat_date >= start,
                KeywordStatDaily.stat_date <= end,
                trusted_stats_filter(),
            )
        )
        .group_by(KeywordStatDaily.keyword_text, KeywordStatDaily.product_category)
    ).all()

    registered = _registered_keywords(db)
    proven: dict[str, list[dict]] = defaultdict(list)   # 상품 표현 → 성과가 확인된 지역 조합
    seen_regions: dict[str, set[str]] = defaultdict(set)

    for keyword_text, category, clicks, cost, impressions, conversions in rows:
        if not keyword_text:
            continue
        signals = extract_intent_signals(keyword_text)
        region = signals["region"] or signals["venue"]
        if not (signals["rental"] and region):
            continue
        product_part = normalize(keyword_text).replace(normalize(region), "", 1)
        clicks = int(clicks or 0)
        ctr = (clicks / int(impressions) * 100) if impressions else None
        proven[product_part].append(
            {
                "region": region,
                "clicks": clicks,
                "cost": float(cost or 0.0),
                "ctr": ctr,
                "conversions": int(conversions or 0),
                "category": category,
            }
        )
        seen_regions[product_part].add(region)

    from app.services.classification.dictionary import REGIONS

    candidates: list[OpportunityCandidate] = []
    for product_part, records in proven.items():
        total_clicks = sum(r["clicks"] for r in records)
        if total_clicks < 20 or len(records) < 2:
            continue  # 성과 근거가 약하면 확장하지 않는다
        avg_ctr = sum(r["ctr"] for r in records if r["ctr"]) / max(len([r for r in records if r["ctr"]]), 1)
        avg_cpc = sum(r["cost"] for r in records) / total_clicks if total_clicks else None
        category = records[0]["category"]
        converting = sum(r["conversions"] for r in records)

        for region in REGIONS:
            if region in seen_regions[product_part]:
                continue
            new_keyword = f"{region}{product_part}"
            if normalize(new_keyword) in registered:
                continue
            evidence = [
                Evidence(
                    "SIMILAR_KEYWORD_PERFORMANCE",
                    f"동일 상품의 다른 지역 조합 {len(records)}건에서 클릭 {total_clicks}회 발생",
                    35.0,
                ),
                Evidence("HIGH_INTENT_STRUCTURE", "지역 + 상품 + 렌탈 구조 (§15 고의도)", 25.0),
            ]
            if avg_ctr and avg_ctr >= 5:
                evidence.append(Evidence("HIGH_CTR_PATTERN", f"유사 조합 평균 CTR {avg_ctr:.1f}%", 15.0))
            if converting:
                evidence.append(Evidence("CONVERTED", f"유사 조합 전환 {converting}건", 20.0))
            candidates.append(
                OpportunityCandidate(
                    keyword_text=new_keyword,
                    opportunity_type="REGION",
                    product_category=category,
                    region=region,
                    estimated_cpc=round(avg_cpc, 1) if avg_cpc else None,
                    evidence=evidence,
                )
            )
    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates[:top_n]


def from_events(db: Session, as_of: date, horizon_days: int = 120) -> list[OpportunityCandidate]:
    """Event Opportunity (§22) — 다가오는 행사에 맞춘 사전세팅 후보."""
    events = db.scalars(
        select(Event).where(
            Event.start_date >= as_of, Event.start_date <= as_of + timedelta(days=horizon_days)
        )
    ).all()
    registered = _registered_keywords(db)
    candidates: list[OpportunityCandidate] = []

    for event in events:
        days_left = (event.start_date - as_of).days
        for keyword_text in event.suggested_keywords or []:
            if normalize(keyword_text) in registered:
                continue
            classification = classify_keyword(keyword_text)
            evidence = [
                Evidence(
                    "EVENT_DEMAND",
                    f"{event.name} ({event.venue}, {event.start_date.isoformat()}) D-{days_left}",
                    40.0,
                ),
                Evidence("HIGH_INTENT_STRUCTURE", "행사명/행사장 + 상품 + 렌탈 구조", 25.0),
            ]
            if event.region:
                evidence.append(Evidence("REGION_DEMAND", f"{event.region} 지역 수요", 15.0))
            candidates.append(
                OpportunityCandidate(
                    keyword_text=keyword_text,
                    opportunity_type="EVENT",
                    product_category=classification.category,
                    region=event.region,
                    event_id=event.id,
                    evidence=evidence,
                )
            )
    return candidates


def generate(db: Session, as_of: date, lookback_days: int = 90, persist: bool = True) -> list[OpportunityCandidate]:
    start = as_of - timedelta(days=lookback_days)
    candidates = (
        from_search_terms(db, start, as_of)
        + region_expansion(db, start, as_of)
        + from_events(db, as_of)
    )
    # 근거 2개 미만은 제외 (§17)
    candidates = [c for c in candidates if len(c.evidence) >= MIN_EVIDENCE_COUNT]
    candidates.sort(key=lambda c: c.confidence, reverse=True)

    if persist:
        for candidate in candidates:
            existing = db.scalar(
                select(Opportunity).where(
                    Opportunity.keyword_text == candidate.keyword_text,
                    Opportunity.opportunity_type == candidate.opportunity_type,
                )
            )
            row = existing or Opportunity(
                keyword_text=candidate.keyword_text, opportunity_type=candidate.opportunity_type
            )
            row.product_category = candidate.product_category
            row.region = candidate.region
            row.event_id = candidate.event_id
            row.estimated_cpc = candidate.estimated_cpc
            row.confidence = candidate.confidence
            row.evidence = [e.as_dict() for e in candidate.evidence]
            row.evidence_count = len(candidate.evidence)
            row.generated_on = as_of
            if existing is None:
                db.add(row)
        db.commit()
    return candidates


def for_ceo_report(candidates: list[OpportunityCandidate], min_confidence: int | None = None) -> list[dict]:
    """CEO 보고서용 — 기본 70점 미만은 제외 (§17)."""
    threshold = settings.ceo_report_min_confidence if min_confidence is None else min_confidence
    return [c.as_dict() for c in candidates if c.confidence >= threshold]
