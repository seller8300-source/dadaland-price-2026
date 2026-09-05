"""STEP 5 — Keyword Competition Measurement Module (§18–19).

중복 광고를 '무조건 낭비' 로 보지 않는다. 시장규모·시즌·정책을 반영해
  * Allowed Competition Spend  (의도적으로 허용된 경쟁 비용)
  * Reallocation Review Spend  (재배치 검토 대상 비용)
두 금액을 분리해서 보여준다. 검토 대상 = 삭감 확정이 아니다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.enums import CompetitionPolicy, SeasonState
from app.models import Account, CompetitionCluster, KeywordStatDaily
from app.services.competition.clusters import cluster_parts_for
from app.services.quality.validator import trusted_stats_filter
from app.services.season.predictor import assess as assess_season

# 시장이 크면 경쟁 계정 수를 1개 더 허용한다 (§18 시장규모 반영).
LARGE_MARKET_IMPRESSIONS = 100_000
MIN_CLUSTER_COST = 10_000.0  # 이 미만은 리포트 노이즈


@dataclass(slots=True)
class AccountShare:
    account_id: int
    account_name: str
    cost: float = 0.0
    clicks: int = 0
    impressions: int = 0
    conversions: int = 0
    conversion_value: float = 0.0
    rank_weighted_sum: float = 0.0
    rank_weight: float = 0.0
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
            "account": self.account_name,
            "cost": round(self.cost, 1),
            "clicks": self.clicks,
            "impressions": self.impressions,
            "conversions": self.conversions,
            "revenue": round(self.conversion_value, 1),
            "cpc": round(self.cpc, 1) if self.cpc else None,
            "ctr": round(self.ctr, 2) if self.ctr else None,
            "average_rank": round(self.average_rank, 2) if self.average_rank else None,
            "cost_per_conversion": round(self.cost_per_conversion, 1) if self.cost_per_conversion else None,
            "keyword_count": len(self.keywords),
        }


@dataclass(slots=True)
class ClusterMeasurement:
    cluster_key: str
    label: str
    product_category: str
    intent_type: str
    scope: str | None
    season_state: str
    policy: str
    allowed_account_count: int
    accounts: list[AccountShare]
    allowed_spend: float
    review_spend: float
    market_impressions: int
    has_conversion_data: bool
    primary_account: str | None = None
    reasons: list[str] = field(default_factory=list)

    @property
    def total_cost(self) -> float:
        return sum(a.cost for a in self.accounts)

    def as_dict(self) -> dict:
        return {
            "cluster_key": self.cluster_key,
            "label": self.label,
            "product_category": self.product_category,
            "intent_type": self.intent_type,
            "scope": self.scope,
            "season_state": self.season_state,
            "policy": self.policy,
            "primary_account": self.primary_account,
            "account_count": len(self.accounts),
            "allowed_account_count": self.allowed_account_count,
            "total_cost": round(self.total_cost, 1),
            "allowed_competition_spend": round(self.allowed_spend, 1),
            "reallocation_review_spend": round(self.review_spend, 1),
            "market_impressions": self.market_impressions,
            "has_conversion_data": self.has_conversion_data,
            "accounts": [a.as_dict() for a in self.accounts],
            "reasons": self.reasons,
        }


def _policy_for(
    db: Session, product_category: str, cluster_key: str
) -> tuple[str, int | None, int | None, int | None]:
    """클러스터 정책 → 없으면 상품군 기본 정책 (seed 된 category:* 행)."""
    cluster = db.scalar(select(CompetitionCluster).where(CompetitionCluster.cluster_key == cluster_key))
    if cluster and (cluster.max_accounts_in_season or cluster.max_accounts_off_season):
        return (
            cluster.policy,
            cluster.max_accounts_off_season,
            cluster.max_accounts_in_season,
            cluster.primary_account_id,
        )
    default = db.scalar(
        select(CompetitionCluster).where(CompetitionCluster.cluster_key == f"category:{product_category}")
    )
    if default:
        return (
            default.policy,
            default.max_accounts_off_season,
            default.max_accounts_in_season,
            default.primary_account_id,
        )
    return CompetitionPolicy.ALLOWED, 2, 4, None


def _efficiency_key(share: AccountShare, has_conversion_data: bool):
    """효율 순위 기준. 전환 데이터가 있으면 전환당 비용, 없으면 CPC/CTR 복합."""
    if has_conversion_data and share.conversions:
        return (0, share.cost / share.conversions)
    if has_conversion_data and not share.conversions:
        return (2, -share.clicks)  # 전환 0 인 계정은 뒤로
    cpc = share.cpc or float("inf")
    ctr = share.ctr or 0.01
    return (1, cpc / ctr)


def measure(
    db: Session,
    start: date,
    end: date,
    as_of: date | None = None,
    min_cost: float = MIN_CLUSTER_COST,
) -> list[ClusterMeasurement]:
    """구간 내 모든 Intent Cluster 의 경쟁 상태를 측정한다."""
    as_of = as_of or end
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}

    rows = db.execute(
        select(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.product_category,
            func.sum(KeywordStatDaily.cost),
            func.sum(KeywordStatDaily.clicks),
            func.sum(KeywordStatDaily.impressions),
            func.sum(KeywordStatDaily.conversions),
            func.sum(KeywordStatDaily.conversion_value),
            func.sum(KeywordStatDaily.average_rank * KeywordStatDaily.clicks),
        )
        .where(
            and_(
                KeywordStatDaily.stat_date >= start,
                KeywordStatDaily.stat_date <= end,
                trusted_stats_filter(),
            )
        )
        .group_by(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.product_category,
        )
    ).all()

    grouped: dict[str, dict] = {}
    for (
        account_id,
        keyword_text,
        product_category,
        cost,
        clicks,
        impressions,
        conversions,
        conversion_value,
        rank_sum,
    ) in rows:
        if not keyword_text or account_id is None:
            continue
        parts = cluster_parts_for(keyword_text, product_category)
        bucket = grouped.setdefault(parts.key, {"parts": parts, "shares": {}})
        share = bucket["shares"].setdefault(
            account_id,
            AccountShare(
                account_id=account_id,
                account_name=accounts[account_id].name if account_id in accounts else str(account_id),
            ),
        )
        clicks = int(clicks or 0)
        share.cost += float(cost or 0.0)
        share.clicks += clicks
        share.impressions += int(impressions or 0)
        share.conversions += int(conversions or 0)
        share.conversion_value += float(conversion_value or 0.0)
        if rank_sum:
            share.rank_weighted_sum += float(rank_sum)
            share.rank_weight += clicks
        share.keywords.add(keyword_text)

    season_cache: dict[str, str] = {}
    measurements: list[ClusterMeasurement] = []

    for key, bucket in grouped.items():
        parts = bucket["parts"]
        shares: list[AccountShare] = sorted(bucket["shares"].values(), key=lambda s: s.cost, reverse=True)
        total_cost = sum(s.cost for s in shares)
        if total_cost < min_cost:
            continue

        category = parts.product_category
        if category not in season_cache:
            season_cache[category] = assess_season(db, category, as_of).state
        season_state = season_cache[category]
        in_season = season_state in (SeasonState.RISING, SeasonState.PEAK)

        policy, max_off, max_in, primary_id = _policy_for(db, category, key)
        allowed_count = (max_in if in_season else max_off) or 2
        market_impressions = sum(s.impressions for s in shares)
        reasons: list[str] = []
        if market_impressions >= LARGE_MARKET_IMPRESSIONS:
            allowed_count += 1
            reasons.append(
                f"시장규모 큼(노출 {market_impressions:,}) — 경쟁 허용 계정 수 +1"
            )
        reasons.append(f"시즌 상태 {season_state} 기준 허용 계정 수 {allowed_count}")

        has_conversion_data = any(s.conversions for s in shares)
        if not has_conversion_data:
            reasons.append("전환 데이터 없음 — 효율 순위는 CPC/CTR 기준 잠정치 (DATA INSUFFICIENT)")

        primary_name = accounts[primary_id].name if primary_id and primary_id in accounts else None
        ordered = sorted(shares, key=lambda s: _efficiency_key(s, has_conversion_data))
        if policy in (CompetitionPolicy.PRIMARY_ONLY, CompetitionPolicy.PRIMARY_PLUS_CHALLENGER) and primary_id:
            primary_shares = [s for s in ordered if s.account_id == primary_id]
            ordered = primary_shares + [s for s in ordered if s.account_id != primary_id]
            if policy == CompetitionPolicy.PRIMARY_ONLY:
                allowed_count = 1
            reasons.append(
                f"{primary_name} Primary 정책 — 비시즌 {max_off or 1}개, 성수기 {max_in or 1}개 계정까지 허용"
            )

        allowed_spend = sum(s.cost for s in ordered[:allowed_count])
        review_spend = sum(s.cost for s in ordered[allowed_count:])
        if review_spend > 0:
            reasons.append(
                "계정 수가 허용치를 초과 — 초과분은 재배치 '검토' 대상이며 삭감 확정이 아니다"
            )

        measurements.append(
            ClusterMeasurement(
                cluster_key=key,
                label=parts.label,
                product_category=category,
                intent_type=parts.intent_type,
                scope=parts.scope,
                season_state=season_state,
                policy=policy,
                allowed_account_count=allowed_count,
                accounts=shares,
                allowed_spend=allowed_spend,
                review_spend=review_spend,
                market_impressions=market_impressions,
                has_conversion_data=has_conversion_data,
                primary_account=primary_name,
                reasons=reasons,
            )
        )

    return sorted(measurements, key=lambda m: m.review_spend, reverse=True)


def summarize(measurements: list[ClusterMeasurement]) -> dict:
    """회사 전체 관점의 경쟁 비용 요약 (§18)."""
    total_allowed = sum(m.allowed_spend for m in measurements)
    total_review = sum(m.review_spend for m in measurements)
    multi_account = [m for m in measurements if len(m.accounts) > 1]
    return {
        "cluster_count": len(measurements),
        "multi_account_cluster_count": len(multi_account),
        "allowed_competition_spend": round(total_allowed, 1),
        "reallocation_review_spend": round(total_review, 1),
        "review_share_pct": round(total_review / (total_allowed + total_review) * 100, 1)
        if (total_allowed + total_review)
        else 0.0,
        "top_review_clusters": [m.as_dict() for m in measurements[:10] if m.review_spend > 0],
    }
