"""Recommendation Tracking (§29).

추천 전/후 Snapshot 을 저장하고 실제 효과를 판정한다.
효과 판정 결과는 향후 유사 상황 추천의 근거가 된다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.enums import RecommendationOutcome, RecommendationStatus
from app.models import KeywordStatDaily, Recommendation, RecommendationResult
from app.services.quality.validator import trusted_stats_filter

DEFAULT_WINDOW_DAYS = 14
SUCCESS_COST_DROP_PCT = -10.0
ACCEPTABLE_CLICK_DROP_PCT = -15.0


@dataclass(slots=True)
class Snapshot:
    cost: float
    clicks: int
    impressions: int
    conversions: int
    cpc: float | None
    ctr: float | None
    average_rank: float | None

    def as_dict(self) -> dict:
        return {
            "cost": round(self.cost, 1),
            "clicks": self.clicks,
            "impressions": self.impressions,
            "conversions": self.conversions,
            "cpc": round(self.cpc, 1) if self.cpc else None,
            "ctr": round(self.ctr, 2) if self.ctr else None,
            "average_rank": round(self.average_rank, 2) if self.average_rank else None,
        }


def snapshot(
    db: Session,
    start: date,
    end: date,
    account_id: int | None = None,
    keyword_text: str | None = None,
) -> Snapshot:
    conditions = [
        KeywordStatDaily.stat_date >= start,
        KeywordStatDaily.stat_date <= end,
        trusted_stats_filter(),
    ]
    if account_id is not None:
        conditions.append(KeywordStatDaily.account_id == account_id)
    if keyword_text is not None:
        conditions.append(KeywordStatDaily.keyword_text == keyword_text)

    cost, clicks, impressions, conversions, rank_sum, rank_weight = db.execute(
        select(
            func.sum(KeywordStatDaily.cost),
            func.sum(KeywordStatDaily.clicks),
            func.sum(KeywordStatDaily.impressions),
            func.sum(KeywordStatDaily.conversions),
            func.sum(KeywordStatDaily.average_rank * KeywordStatDaily.clicks),
            func.sum(KeywordStatDaily.clicks),
        ).where(and_(*conditions))
    ).one()

    cost = float(cost or 0.0)
    clicks = int(clicks or 0)
    impressions = int(impressions or 0)
    return Snapshot(
        cost=cost,
        clicks=clicks,
        impressions=impressions,
        conversions=int(conversions or 0),
        cpc=cost / clicks if clicks else None,
        ctr=clicks / impressions * 100 if impressions else None,
        average_rank=float(rank_sum) / int(rank_weight) if rank_sum and rank_weight else None,
    )


def capture_baseline(
    db: Session, recommendation: Recommendation, window_days: int = DEFAULT_WINDOW_DAYS
) -> Snapshot:
    """추천 시점의 '변경 전' 스냅샷을 저장한다."""
    end = recommendation.as_of_date
    start = end - timedelta(days=window_days - 1)
    before = snapshot(db, start, end, recommendation.account_id, recommendation.keyword_text)
    recommendation.baseline_snapshot = {
        "period": [start.isoformat(), end.isoformat()],
        **before.as_dict(),
    }
    db.commit()
    return before


def evaluate(
    db: Session,
    recommendation: Recommendation,
    measured_on: date,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> RecommendationResult:
    """적용 후 구간과 baseline 을 비교해 SUCCESS/NEUTRAL/FAILURE 를 판정한다."""
    if not recommendation.baseline_snapshot:
        capture_baseline(db, recommendation, window_days)

    after_start = measured_on - timedelta(days=window_days - 1)
    after = snapshot(db, after_start, measured_on, recommendation.account_id, recommendation.keyword_text)
    before = recommendation.baseline_snapshot or {}

    def change(key: str) -> float | None:
        base = before.get(key)
        current = after.as_dict().get(key)
        if not base or current is None:
            return None
        return (current - base) / base * 100

    delta = {key: change(key) for key in ("cost", "clicks", "cpc", "ctr", "average_rank", "conversions")}

    outcome = RecommendationOutcome.PENDING
    if after.clicks == 0 and not before.get("clicks"):
        outcome = RecommendationOutcome.DATA_INSUFFICIENT
    else:
        cost_change = delta.get("cost")
        click_change = delta.get("clicks")
        conversion_change = delta.get("conversions")
        if cost_change is None:
            outcome = RecommendationOutcome.DATA_INSUFFICIENT
        elif (
            cost_change <= SUCCESS_COST_DROP_PCT
            and (click_change is None or click_change >= ACCEPTABLE_CLICK_DROP_PCT)
        ):
            outcome = RecommendationOutcome.SUCCESS
        elif conversion_change is not None and conversion_change > 0 and (cost_change or 0) <= 0:
            outcome = RecommendationOutcome.SUCCESS
        elif click_change is not None and click_change < ACCEPTABLE_CLICK_DROP_PCT:
            outcome = RecommendationOutcome.FAILURE
        else:
            outcome = RecommendationOutcome.NEUTRAL

    result = RecommendationResult(
        recommendation_id=recommendation.id,
        measured_on=measured_on,
        window_days=window_days,
        before_snapshot=before,
        after_snapshot={"period": [after_start.isoformat(), measured_on.isoformat()], **after.as_dict()},
        delta={k: (round(v, 1) if v is not None else None) for k, v in delta.items()},
        outcome=outcome,
        note=_outcome_note(outcome, delta),
    )
    db.add(result)
    db.commit()
    return result


def _outcome_note(outcome: str, delta: dict) -> str:
    cost = delta.get("cost")
    clicks = delta.get("clicks")
    parts = []
    if cost is not None:
        parts.append(f"비용 {cost:+.0f}%")
    if clicks is not None:
        parts.append(f"클릭 {clicks:+.0f}%")
    summary = ", ".join(parts) or "비교 데이터 부족"
    return f"{outcome} — {summary}"


def effectiveness(db: Session, since: date) -> dict:
    """지난 추천들이 실제 효과가 있었는지 (§28 주간 리포트에 사용)."""
    rows = db.execute(
        select(RecommendationResult.outcome, func.count(RecommendationResult.id))
        .where(RecommendationResult.measured_on >= since)
        .group_by(RecommendationResult.outcome)
    ).all()
    counts = {outcome: int(count) for outcome, count in rows}
    total = sum(counts.values())
    applied = db.scalar(
        select(func.count(Recommendation.id)).where(
            Recommendation.as_of_date >= since,
            Recommendation.status.in_(
                [RecommendationStatus.APPLIED, RecommendationStatus.SENT_TO_AGENCY]
            ),
        )
    )
    return {
        "measured": total,
        "applied_recommendations": int(applied or 0),
        "by_outcome": counts,
        "success_rate_pct": round(counts.get(RecommendationOutcome.SUCCESS, 0) / total * 100, 1)
        if total
        else None,
        "status": "OK" if total else "DATA INSUFFICIENT — 아직 측정된 추천 결과가 없습니다.",
    }
