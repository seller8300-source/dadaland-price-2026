"""집계 원시 지표와 파생 지표 계산."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.models import KeywordStatDaily
from app.services.quality.validator import trusted_stats_filter


@dataclass(slots=True)
class Metrics:
    """한 구간의 광고 지표 묶음."""

    cost: float = 0.0
    clicks: int = 0
    impressions: int = 0
    conversions: int = 0
    conversion_value: float = 0.0
    rank_weighted_sum: float = 0.0
    rank_weight: float = 0.0
    keyword_count: int = 0
    campaign_count: int = 0
    keywords: set[str] = field(default_factory=set)

    @property
    def cpc(self) -> float | None:
        return self.cost / self.clicks if self.clicks else None

    @property
    def ctr(self) -> float | None:
        return self.clicks / self.impressions * 100 if self.impressions else None

    @property
    def average_rank(self) -> float | None:
        return self.rank_weighted_sum / self.rank_weight if self.rank_weight else None

    @property
    def cost_per_conversion(self) -> float | None:
        return self.cost / self.conversions if self.conversions else None

    def as_dict(self) -> dict:
        return {
            "cost": round(self.cost, 1),
            "clicks": self.clicks,
            "impressions": self.impressions,
            "conversions": self.conversions,
            "conversion_value": round(self.conversion_value, 1),
            "cpc": round(self.cpc, 1) if self.cpc is not None else None,
            "ctr": round(self.ctr, 2) if self.ctr is not None else None,
            "average_rank": round(self.average_rank, 2) if self.average_rank is not None else None,
            "keyword_count": self.keyword_count,
            "campaign_count": self.campaign_count,
        }


def _base_query(
    start: date,
    end: date,
    account_id: int | None = None,
    product_category: str | None = None,
    include_rejected: bool = False,
    exclude_keywords: set[str] | None = None,
) -> Select:
    conditions = [KeywordStatDaily.stat_date >= start, KeywordStatDaily.stat_date <= end]
    if account_id is not None:
        conditions.append(KeywordStatDaily.account_id == account_id)
    if product_category is not None:
        conditions.append(KeywordStatDaily.product_category == product_category)
    if not include_rejected:
        conditions.append(trusted_stats_filter())
    if exclude_keywords:
        conditions.append(KeywordStatDaily.keyword_text.notin_(sorted(exclude_keywords)))
    return select(KeywordStatDaily).where(and_(*conditions))


def period_metrics(
    db: Session,
    start: date,
    end: date,
    account_id: int | None = None,
    product_category: str | None = None,
    include_rejected: bool = False,
    exclude_keywords: set[str] | None = None,
) -> Metrics:
    """검증을 통과한(=REJECTED 가 아닌) 데이터만 집계한다 (§8).

    ``exclude_keywords`` 는 한쪽 기간에서만 데이터가 버려진 키워드를 양쪽 기간에서
    함께 빼기 위한 것이다 — 비교는 항상 같은 대상끼리 해야 한다.
    """
    metrics = Metrics()
    query = _base_query(start, end, account_id, product_category, include_rejected, exclude_keywords)
    campaigns: set[int] = set()
    for stat in db.scalars(query):
        metrics.cost += float(stat.cost or 0.0)
        metrics.clicks += int(stat.clicks or 0)
        metrics.impressions += int(stat.impressions or 0)
        metrics.conversions += int(stat.conversions or 0)
        metrics.conversion_value += float(stat.conversion_value or 0.0)
        if stat.average_rank and stat.clicks:
            metrics.rank_weighted_sum += float(stat.average_rank) * int(stat.clicks)
            metrics.rank_weight += int(stat.clicks)
        if stat.keyword_text:
            metrics.keywords.add(stat.keyword_text)
        if stat.campaign_id:
            campaigns.add(stat.campaign_id)
    metrics.keyword_count = len(metrics.keywords)
    metrics.campaign_count = len(campaigns)
    return metrics


def category_breakdown(
    db: Session, start: date, end: date, account_id: int | None = None
) -> dict[str, dict]:
    """상품군별 비중 (§27 '상품군별 비중')."""
    conditions = [
        KeywordStatDaily.stat_date >= start,
        KeywordStatDaily.stat_date <= end,
        trusted_stats_filter(),
    ]
    if account_id is not None:
        conditions.append(KeywordStatDaily.account_id == account_id)

    rows = db.execute(
        select(
            KeywordStatDaily.product_category,
            func.sum(KeywordStatDaily.cost),
            func.sum(KeywordStatDaily.clicks),
            func.sum(KeywordStatDaily.impressions),
            func.sum(KeywordStatDaily.conversions),
        )
        .where(and_(*conditions))
        .group_by(KeywordStatDaily.product_category)
    ).all()

    total_cost = sum(float(r[1] or 0.0) for r in rows) or 1.0
    breakdown: dict[str, dict] = {}
    for category, cost, clicks, impressions, conversions in rows:
        cost = float(cost or 0.0)
        clicks = int(clicks or 0)
        impressions = int(impressions or 0)
        breakdown[category or "미분류"] = {
            "cost": round(cost, 1),
            "share": round(cost / total_cost * 100, 1),
            "clicks": clicks,
            "impressions": impressions,
            "conversions": int(conversions or 0),
            "cpc": round(cost / clicks, 1) if clicks else None,
            "ctr": round(clicks / impressions * 100, 2) if impressions else None,
        }
    return dict(sorted(breakdown.items(), key=lambda kv: kv[1]["cost"], reverse=True))


def pct_change(before: float | None, after: float | None) -> float | None:
    """증감률(%). 기준값이 0 이거나 없으면 None — 0으로 나눠 과장하지 않는다."""
    if before in (None, 0) or after is None:
        return None
    return (after - before) / before * 100


def rejected_keywords(db: Session, account_id: int | None = None) -> set[str]:
    """데이터 오류로 REJECTED 된 행이 있는 키워드 목록.

    이런 키워드는 한쪽 기간에만 데이터가 남아 YoY 비교를 왜곡하므로,
    비교에서 통째로 제외하고 그 사실을 리포트에 남긴다 (§9).
    """
    from app.core.enums import TrustStatus

    conditions = [KeywordStatDaily.trust_status == TrustStatus.REJECTED]
    if account_id is not None:
        conditions.append(KeywordStatDaily.account_id == account_id)
    rows = db.scalars(select(KeywordStatDaily.keyword_text).where(and_(*conditions)).distinct())
    return {row for row in rows if row}
