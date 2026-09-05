"""Recommendation Tracking (§29) — 추천 전/후 Snapshot 비교."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import RecommendationOutcome, TrustStatus
from app.models import Account, KeywordStatDaily, Recommendation
from app.services.recommendation import tracking

AS_OF = date(2026, 6, 15)


def _spend(db: Session, account: Account, day: date, clicks: int, cost: float, rank: float) -> None:
    db.add(
        KeywordStatDaily(
            account_id=account.id,
            stat_date=day,
            keyword_text="코끼리에어컨",
            impressions=clicks * 25,
            clicks=clicks,
            cost=cost,
            average_rank=rank,
            product_category="냉방",
            trust_status=TrustStatus.TRUSTED,
        )
    )


def _recommendation(db: Session, account: Account) -> Recommendation:
    recommendation = Recommendation(
        account_id=account.id,
        as_of_date=AS_OF,
        action_type="BID_DOWN",
        keyword_text="코끼리에어컨",
        title="코끼리에어컨 입찰가 -20%",
        detail="1.4위 유지 중 — 2~3위 구간 테스트",
        confidence=80,
    )
    db.add(recommendation)
    db.commit()
    return recommendation


def test_success_when_cost_drops_without_losing_clicks(db: Session) -> None:
    """§29 예시 — 비용 -41%, 클릭 -9% → SUCCESS."""
    account = db.scalar(select(Account).where(Account.name == "마니"))
    for offset in range(14):  # 변경 전 14일: 순위 1.4 / CPC 7,000 / 클릭 100 / 비용 700,000
        _spend(db, account, AS_OF - timedelta(days=offset), 100, 700_000, 1.4)
    db.commit()

    recommendation = _recommendation(db, account)
    tracking.capture_baseline(db, recommendation)
    assert recommendation.baseline_snapshot["cpc"] == 7_000

    measured_on = AS_OF + timedelta(days=20)
    for offset in range(14):  # 변경 후: 순위 2.7 / CPC 4,500 / 클릭 91 / 비용 409,500
        _spend(db, account, measured_on - timedelta(days=offset), 91, 409_500, 2.7)
    db.commit()

    result = tracking.evaluate(db, recommendation, measured_on)
    assert result.outcome == RecommendationOutcome.SUCCESS
    assert result.delta["cost"] == -41.5
    assert result.delta["clicks"] == -9.0
    assert result.after_snapshot["average_rank"] == 2.7


def test_failure_when_clicks_collapse(db: Session) -> None:
    account = db.scalar(select(Account).where(Account.name == "마니"))
    for offset in range(14):
        _spend(db, account, AS_OF - timedelta(days=offset), 100, 700_000, 1.4)
    db.commit()
    recommendation = _recommendation(db, account)
    tracking.capture_baseline(db, recommendation)

    measured_on = AS_OF + timedelta(days=20)
    for offset in range(14):
        _spend(db, account, measured_on - timedelta(days=offset), 30, 690_000, 4.5)
    db.commit()

    result = tracking.evaluate(db, recommendation, measured_on)
    assert result.outcome == RecommendationOutcome.FAILURE


def test_effectiveness_reports_data_insufficient_when_empty(db: Session) -> None:
    assert tracking.effectiveness(db, AS_OF)["status"].startswith("DATA INSUFFICIENT")
