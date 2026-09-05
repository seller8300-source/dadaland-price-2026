"""§12 — 광고비 증가 원인 분해.

Δcost = (Δclicks × cpc_before) + (Δcpc × clicks_before) + (Δclicks × Δcpc)

클릭 기여분과 CPC 기여분을 분리하고, 순위/캠페인/신규키워드/비효율 유입까지
가능한 범위에서 부가 원인을 붙인다. 근거가 없으면 추측하지 않고
DATA_INSUFFICIENT 로 남긴다 (§40).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.enums import SpendDriver
from app.models import KeywordStatDaily
from app.services.benchmark.metrics import Metrics, pct_change, period_metrics
from app.services.quality.validator import trusted_stats_filter

MATERIAL_CHANGE_PCT = 5.0     # 이보다 작은 변화는 '유의미한 변화 없음'
DOMINANCE_RATIO = 0.65        # 한 요인이 비용변화의 65% 이상이면 단일 원인
RANK_IMPROVEMENT_PCT = 10.0   # 평균순위가 10% 이상 좋아지면(=숫자가 작아지면) 상위입찰


@dataclass(slots=True)
class SpendDecomposition:
    cost_before: float
    cost_after: float
    cost_delta: float
    cost_change_pct: float | None
    click_effect: float
    cpc_effect: float
    interaction_effect: float
    click_change_pct: float | None
    cpc_change_pct: float | None
    ctr_change_pct: float | None
    rank_before: float | None
    rank_after: float | None
    primary_driver: str
    secondary_drivers: list[str] = field(default_factory=list)
    new_keyword_cost: float = 0.0
    new_keyword_share: float = 0.0
    campaign_count_before: int = 0
    campaign_count_after: int = 0
    explanation: str = ""

    def as_dict(self) -> dict:
        return {
            "cost_before": round(self.cost_before, 1),
            "cost_after": round(self.cost_after, 1),
            "cost_delta": round(self.cost_delta, 1),
            "cost_change_pct": round(self.cost_change_pct, 1) if self.cost_change_pct is not None else None,
            "click_effect": round(self.click_effect, 1),
            "cpc_effect": round(self.cpc_effect, 1),
            "interaction_effect": round(self.interaction_effect, 1),
            "click_change_pct": round(self.click_change_pct, 1) if self.click_change_pct is not None else None,
            "cpc_change_pct": round(self.cpc_change_pct, 1) if self.cpc_change_pct is not None else None,
            "ctr_change_pct": round(self.ctr_change_pct, 1) if self.ctr_change_pct is not None else None,
            "rank_before": self.rank_before,
            "rank_after": self.rank_after,
            "primary_driver": self.primary_driver,
            "secondary_drivers": self.secondary_drivers,
            "new_keyword_cost": round(self.new_keyword_cost, 1),
            "new_keyword_share": round(self.new_keyword_share, 1),
            "campaign_count_before": self.campaign_count_before,
            "campaign_count_after": self.campaign_count_after,
            "explanation": self.explanation,
        }


def decompose(before: Metrics, after: Metrics) -> SpendDecomposition:
    """두 구간의 지표로 비용 변화를 요인 분해한다."""
    cpc_before = before.cpc or 0.0
    cpc_after = after.cpc or 0.0
    click_delta = after.clicks - before.clicks
    cpc_delta = cpc_after - cpc_before

    click_effect = click_delta * cpc_before
    cpc_effect = cpc_delta * before.clicks
    interaction = click_delta * cpc_delta

    cost_delta = after.cost - before.cost
    click_change = pct_change(before.clicks, after.clicks)
    cpc_change = pct_change(before.cpc, after.cpc)
    ctr_change = pct_change(before.ctr, after.ctr)

    decomposition = SpendDecomposition(
        cost_before=before.cost,
        cost_after=after.cost,
        cost_delta=cost_delta,
        cost_change_pct=pct_change(before.cost, after.cost),
        click_effect=click_effect,
        cpc_effect=cpc_effect,
        interaction_effect=interaction,
        click_change_pct=click_change,
        cpc_change_pct=cpc_change,
        ctr_change_pct=ctr_change,
        rank_before=round(before.average_rank, 2) if before.average_rank else None,
        rank_after=round(after.average_rank, 2) if after.average_rank else None,
        primary_driver=SpendDriver.DATA_INSUFFICIENT,
        campaign_count_before=before.campaign_count,
        campaign_count_after=after.campaign_count,
    )

    if before.cost <= 0 or before.clicks <= 0:
        decomposition.primary_driver = SpendDriver.DATA_INSUFFICIENT
        decomposition.explanation = "비교 기준 구간 데이터가 없어 원인 분해 불가 (DATA INSUFFICIENT)."
        return decomposition

    if decomposition.cost_change_pct is not None and abs(decomposition.cost_change_pct) < MATERIAL_CHANGE_PCT:
        decomposition.primary_driver = SpendDriver.NO_MATERIAL_CHANGE
        decomposition.explanation = "광고비 변화가 유의미하지 않음."
        return decomposition

    magnitude = abs(click_effect) + abs(cpc_effect) + abs(interaction) or 1.0
    click_share = abs(click_effect) / magnitude
    cpc_share = abs(cpc_effect) / magnitude

    if click_share >= DOMINANCE_RATIO:
        decomposition.primary_driver = SpendDriver.A_CLICK_GROWTH
    elif cpc_share >= DOMINANCE_RATIO:
        decomposition.primary_driver = SpendDriver.B_CPC_RISE
    else:
        decomposition.primary_driver = SpendDriver.C_CLICK_AND_CPC

    secondary: list[str] = []
    if (
        before.average_rank
        and after.average_rank
        and (before.average_rank - after.average_rank) / before.average_rank * 100 >= RANK_IMPROVEMENT_PCT
    ):
        secondary.append(SpendDriver.D_RANK_PUSH)
    if after.campaign_count > before.campaign_count:
        secondary.append(SpendDriver.F_CAMPAIGN_EXPANSION)
    if ctr_change is not None and ctr_change <= -20 and (cpc_change or 0) > 0:
        secondary.append(SpendDriver.H_INEFFICIENT_INFLOW)
    decomposition.secondary_drivers = secondary
    return decomposition


def _new_keyword_cost(
    db: Session,
    account_id: int | None,
    base_start: date,
    base_end: date,
    comp_start: date,
    comp_end: date,
) -> tuple[float, float]:
    """비교 구간에만 존재하는 키워드가 쓴 비용과 그 비중 (§12-G)."""

    def keyword_costs(start: date, end: date) -> dict[str, float]:
        conditions = [
            KeywordStatDaily.stat_date >= start,
            KeywordStatDaily.stat_date <= end,
            trusted_stats_filter(),
        ]
        if account_id is not None:
            conditions.append(KeywordStatDaily.account_id == account_id)
        rows = db.execute(
            select(KeywordStatDaily.keyword_text, func.sum(KeywordStatDaily.cost))
            .where(and_(*conditions))
            .group_by(KeywordStatDaily.keyword_text)
        ).all()
        return {text: float(cost or 0.0) for text, cost in rows if text}

    base = keyword_costs(base_start, base_end)
    comp = keyword_costs(comp_start, comp_end)
    total = sum(comp.values())
    new_cost = sum(cost for text, cost in comp.items() if text not in base)
    return new_cost, (new_cost / total * 100 if total else 0.0)


def explain_cost_change(
    db: Session,
    base_start: date,
    base_end: date,
    comp_start: date,
    comp_end: date,
    account_id: int | None = None,
    product_category: str | None = None,
) -> SpendDecomposition:
    """구간 비교 + 신규키워드 기여도까지 붙인 최종 설명 (§12, §27 한 문장 설명)."""
    before = period_metrics(db, base_start, base_end, account_id, product_category)
    after = period_metrics(db, comp_start, comp_end, account_id, product_category)
    result = decompose(before, after)

    new_cost, new_share = _new_keyword_cost(db, account_id, base_start, base_end, comp_start, comp_end)
    result.new_keyword_cost = new_cost
    result.new_keyword_share = new_share
    if new_share >= 25 and SpendDriver.G_NEW_KEYWORDS not in result.secondary_drivers:
        result.secondary_drivers.append(SpendDriver.G_NEW_KEYWORDS)

    result.explanation = one_sentence(result)
    return result


DRIVER_TEXT = {
    SpendDriver.A_CLICK_GROWTH: "클릭 증가",
    SpendDriver.B_CPC_RISE: "CPC 상승",
    SpendDriver.C_CLICK_AND_CPC: "클릭 증가와 CPC 상승 동시 발생",
    SpendDriver.D_RANK_PUSH: "평균노출순위 상승",
    SpendDriver.E_MARKET_EXPANSION: "검색시장 확대",
    SpendDriver.F_CAMPAIGN_EXPANSION: "캠페인 확대",
    SpendDriver.G_NEW_KEYWORDS: "신규키워드 증가",
    SpendDriver.H_INEFFICIENT_INFLOW: "비효율 키워드 유입 확대",
    SpendDriver.NO_MATERIAL_CHANGE: "유의미한 변화 없음",
    SpendDriver.DATA_INSUFFICIENT: "DATA INSUFFICIENT",
}


def one_sentence(result: SpendDecomposition) -> str:
    """Daily Report 용 한 문장 설명 (§12)."""
    if result.primary_driver == SpendDriver.DATA_INSUFFICIENT:
        return "DATA INSUFFICIENT — 비교 가능한 과거 데이터가 부족해 원인을 단정하지 않음."
    if result.primary_driver == SpendDriver.NO_MATERIAL_CHANGE:
        return "광고비 변화가 유의미하지 않음."

    direction = "증가" if result.cost_delta > 0 else "감소"
    parts = [
        f"광고비 {result.cost_change_pct:+.0f}% {direction}",
        f"주원인은 {DRIVER_TEXT[result.primary_driver]}",
    ]
    if result.click_change_pct is not None and result.cpc_change_pct is not None:
        parts.append(f"(클릭 {result.click_change_pct:+.0f}%, CPC {result.cpc_change_pct:+.0f}%)")
    if result.secondary_drivers:
        parts.append("보조요인 " + ", ".join(DRIVER_TEXT[d] for d in result.secondary_drivers))
    if result.new_keyword_share >= 25:
        parts.append(f"신규키워드가 비용의 {result.new_keyword_share:.0f}% 차지")
    return " · ".join(parts) + "."
