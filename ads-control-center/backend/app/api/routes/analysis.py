"""STEP 3–5 — Benchmark / Competition / Season / Opportunity 라우트."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import Account
from app.services.benchmark.spend_driver import explain_cost_change
from app.services.benchmark.yoy import build_benchmarks, high_intent_region_benchmark
from app.services.competition import measure as competition
from app.services.competition.clusters import build_clusters
from app.services.opportunity import engine as opportunity_engine
from app.services.policy import rules as policy_rules
from app.services.productivity import revenue as productivity
from app.services.season.predictor import refresh_indices

router = APIRouter()


@router.get("/benchmark/yoy")
def yoy(
    base_start: date,
    base_end: date,
    comp_start: date,
    comp_end: date,
    db: Session = Depends(get_db),
) -> dict:
    """2025 vs 2026 동일기간 Benchmark (§4)."""
    return build_benchmarks(db, (base_start, base_end), (comp_start, comp_end)).as_dict()


@router.get("/benchmark/spend-driver")
def spend_driver(
    base_start: date,
    base_end: date,
    comp_start: date,
    comp_end: date,
    account: str | None = None,
    product_category: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """광고비 증가 원인 분해 (§12)."""
    account_id = None
    if account:
        row = db.scalar(select(Account).where(Account.name == account))
        account_id = row.id if row else None
    result = explain_cost_change(
        db, base_start, base_end, comp_start, comp_end, account_id, product_category
    )
    return result.as_dict()


@router.get("/benchmark/region")
def region_benchmark(start: date, end: date, db: Session = Depends(get_db)) -> list[dict]:
    """지역 + 상품 + 렌탈 Benchmark (§15–16)."""
    return high_intent_region_benchmark(db, (start, end))


@router.get("/productivity")
def productivity_view(
    base_start: date,
    base_end: date,
    comp_start: date,
    comp_end: date,
    db: Session = Depends(get_db),
) -> list[dict]:
    """매출 생산성 (§25)."""
    rows = productivity.company_productivity(db, (base_start, base_end), (comp_start, comp_end))
    return [row.as_dict() for row in rows]


@router.get("/productivity/breakeven")
def breakeven(
    ad_cost: float,
    margin_rate: float | None = None,
    account: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """광고비 손익분기 매출 + 광고비율 시나리오 (§26)."""
    account_row = db.scalar(select(Account).where(Account.name == account)) if account else None
    rate = margin_rate if margin_rate is not None else productivity.margin_rate_for(db, account_row)
    return productivity.breakeven_scenarios(ad_cost, rate)


@router.get("/competition")
def competition_view(
    start: date,
    end: date,
    min_cost: float = Query(default=10_000.0),
    db: Session = Depends(get_db),
) -> dict:
    """Keyword Competition Measurement (§18)."""
    measurements = competition.measure(db, start, end, min_cost=min_cost)
    summary = competition.summarize(measurements)
    summary["clusters"] = [m.as_dict() for m in measurements[:100]]
    return summary


@router.post("/competition/clusters/rebuild")
def rebuild_clusters(start: date, end: date, db: Session = Depends(get_db)) -> dict:
    clusters = build_clusters(db, start, end)
    return {"clusters": len(clusters)}


@router.get("/policy/violations")
def policy_violations(start: date, end: date, db: Session = Depends(get_db)) -> list[dict]:
    """허용 상품군 위반 광고 (§6 현대도크 물류 ONLY)."""
    return [v.as_dict() for v in policy_rules.detect_violations(db, start, end)]


@router.get("/season")
def season(as_of: date | None = None, db: Session = Depends(get_db)) -> list[dict]:
    """상품군별 시즌 상태 (§20)."""
    return [a.as_dict() for a in refresh_indices(db, as_of or date.today())]


@router.get("/opportunities")
def opportunities(
    as_of: date | None = None,
    min_confidence: int | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    """미세팅 키워드 / 지역 / 행사 기회 (§16–17). 근거 2개 미만은 생성되지 않는다."""
    candidates = opportunity_engine.generate(db, as_of or date.today())
    if min_confidence is None:
        return [c.as_dict() for c in candidates]
    return opportunity_engine.for_ceo_report(candidates, min_confidence)
