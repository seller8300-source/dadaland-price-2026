"""Season Predictor (§20–21)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.core.enums import ProductCategory, SeasonState
from app.services.season.predictor import assess, refresh_indices, upcoming_season_alerts


def test_month_heuristic_when_history_is_thin(db: Session) -> None:
    """데이터가 부족하면 추측하지 않고 휴리스틱임을 명시한다 (§40)."""
    assessment = assess(db, ProductCategory.COOLING, date(2026, 7, 15))
    assert assessment.evidence["method"] == "MONTH_HEURISTIC"
    assert assessment.state == SeasonState.PEAK  # 7월은 냉방 성수기


def test_off_season_for_bedding_in_june(db: Session) -> None:
    assessment = assess(db, ProductCategory.BEDDING, date(2026, 6, 20))
    assert assessment.state == SeasonState.OFF_SEASON


def test_observed_demand_used_when_history_exists(seeded_db: Session) -> None:
    assessment = assess(seeded_db, ProductCategory.COOLING, date(2026, 7, 20))
    assert assessment.evidence["method"] == "OBSERVED_DEMAND"
    assert assessment.state in (SeasonState.PEAK, SeasonState.RISING)
    assert assessment.demand_index > 0


def test_pre_season_alert_has_setup_window(seeded_db: Session) -> None:
    """본격 상승 예상 최소 14일 전에 알린다 (§20)."""
    as_of = date(2026, 4, 20)
    assessments = refresh_indices(seeded_db, as_of)
    alerts = upcoming_season_alerts(assessments, as_of)
    for alert in alerts:
        assert 14 <= alert["days_left"] <= 45
        assert alert["recommended_setup"][0] and alert["recommended_setup"][1]


def test_indices_are_persisted(seeded_db: Session) -> None:
    from app.models import SeasonIndex

    as_of = date(2026, 8, 31)
    refresh_indices(seeded_db, as_of)
    rows = seeded_db.query(SeasonIndex).filter(SeasonIndex.as_of_date == as_of).all()
    assert {row.product_category for row in rows} >= {
        ProductCategory.COOLING,
        ProductCategory.HEATING,
        ProductCategory.BEDDING,
    }
