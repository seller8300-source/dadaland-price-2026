"""Season Predictor (§20–21).

상품군별로 OFF_SEASON / PRE_SEASON / RISING / PEAK / DECLINING 을 판정한다.
과거 데이터가 충분하면 실측 수요지수를, 부족하면 상품군 마스터의 peak_months
휴리스틱을 쓰고 그 사실을 evidence 에 남긴다 (근거 없는 단정 금지 §40).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.enums import SeasonState
from app.models import KeywordStatDaily, ProductCategoryRow, SeasonIndex
from app.services.quality.validator import trusted_stats_filter

WINDOW_DAYS = 14
# 실측 판정 조건: 충분히 긴 기간(스팬) 과 충분한 관측일 수.
# 주 단위로 집계된 과거 리포트도 스팬이 길면 시즌 판정에 쓸 수 있다.
MIN_HISTORY_SPAN_DAYS = 180
MIN_OBSERVATION_DAYS = 60
PEAK_RATIO = 0.80
RISING_RATIO = 0.45
PRE_SEASON_LEAD_DAYS = 45
ALERT_LEAD_DAYS = 14  # 본격 상승 최소 14일 전 알림 (§20)


@dataclass(slots=True)
class SeasonAssessment:
    product_category: str
    as_of: date
    state: str
    demand_index: float
    yoy_index: float | None
    expected_rise_date: date | None
    recommended_setup_start: date | None
    recommended_setup_end: date | None
    evidence: dict = field(default_factory=dict)

    @property
    def in_season(self) -> bool:
        return self.state in (SeasonState.RISING, SeasonState.PEAK)

    def as_dict(self) -> dict:
        return {
            "product_category": self.product_category,
            "as_of": self.as_of.isoformat(),
            "state": self.state,
            "demand_index": round(self.demand_index, 3),
            "yoy_index": round(self.yoy_index, 3) if self.yoy_index is not None else None,
            "expected_rise_date": self.expected_rise_date.isoformat() if self.expected_rise_date else None,
            "recommended_setup_start": (
                self.recommended_setup_start.isoformat() if self.recommended_setup_start else None
            ),
            "recommended_setup_end": self.recommended_setup_end.isoformat() if self.recommended_setup_end else None,
            "evidence": self.evidence,
            "in_season": self.in_season,
        }


def _daily_demand(db: Session, category: str) -> dict[date, float]:
    rows = db.execute(
        select(KeywordStatDaily.stat_date, func.sum(KeywordStatDaily.impressions))
        .where(and_(KeywordStatDaily.product_category == category, trusted_stats_filter()))
        .group_by(KeywordStatDaily.stat_date)
    ).all()
    return {row[0]: float(row[1] or 0.0) for row in rows}


def _window_sum(series: dict[date, float], end: date, days: int = WINDOW_DAYS) -> float:
    start = end - timedelta(days=days - 1)
    return sum(value for day, value in series.items() if start <= day <= end)


def _peak_month_state(category_row: ProductCategoryRow | None, as_of: date) -> tuple[str, date | None]:
    """실측이 부족할 때 쓰는 월 기반 휴리스틱."""
    if category_row is None or not category_row.is_seasonal or not category_row.peak_months:
        return SeasonState.OFF_SEASON, None
    peaks = set(category_row.peak_months)
    month = as_of.month
    if month in peaks:
        return SeasonState.PEAK, None
    next_month = month % 12 + 1
    after_next = next_month % 12 + 1
    if next_month in peaks:
        first_of_next = date(as_of.year + (1 if next_month < month else 0), next_month, 1)
        return SeasonState.PRE_SEASON, first_of_next
    if after_next in peaks:
        year = as_of.year + (1 if after_next < month else 0)
        return SeasonState.OFF_SEASON, date(year, after_next, 1)
    previous_month = 12 if month == 1 else month - 1
    if previous_month in peaks:
        return SeasonState.DECLINING, None
    return SeasonState.OFF_SEASON, None


def assess(db: Session, category: str, as_of: date) -> SeasonAssessment:
    series = _daily_demand(db, category)
    category_row = db.scalar(select(ProductCategoryRow).where(ProductCategoryRow.code == category))

    history_days = len(series)
    span_days = (max(series) - min(series)).days if series else 0
    if history_days < MIN_OBSERVATION_DAYS or span_days < MIN_HISTORY_SPAN_DAYS:
        state, expected = _peak_month_state(category_row, as_of)
        setup_start = expected - timedelta(days=PRE_SEASON_LEAD_DAYS) if expected else None
        setup_end = expected - timedelta(days=ALERT_LEAD_DAYS) if expected else None
        return SeasonAssessment(
            product_category=category,
            as_of=as_of,
            state=state,
            demand_index=0.0,
            yoy_index=None,
            expected_rise_date=expected,
            recommended_setup_start=setup_start,
            recommended_setup_end=setup_end,
            evidence={
                "method": "MONTH_HEURISTIC",
                "history_days": history_days,
                "span_days": span_days,
                "note": "실측 데이터 부족 — 상품군 마스터의 peak_months 기준 (DATA INSUFFICIENT 보정)",
            },
        )

    current = _window_sum(series, as_of)
    previous = _window_sum(series, as_of - timedelta(days=WINDOW_DAYS))
    yearly_max = max(
        (_window_sum(series, day) for day in series if day <= as_of),
        default=0.0,
    ) or 1.0
    ratio = current / yearly_max
    trend = (current - previous) / previous if previous else None

    last_year = as_of - timedelta(days=365)
    last_year_window = _window_sum(series, last_year)
    yoy_index = (current / last_year_window) if last_year_window else None

    if ratio >= PEAK_RATIO:
        state = SeasonState.PEAK
    elif ratio >= RISING_RATIO and (trend is None or trend > 0.05):
        state = SeasonState.RISING
    elif ratio >= RISING_RATIO:
        state = SeasonState.DECLINING
    elif trend is not None and trend > 0.30:
        state = SeasonState.PRE_SEASON
    else:
        heuristic_state, _ = _peak_month_state(category_row, as_of)
        state = SeasonState.PRE_SEASON if heuristic_state == SeasonState.PRE_SEASON else SeasonState.OFF_SEASON

    expected_rise = _expected_rise_from_history(series, as_of)
    setup_start = expected_rise - timedelta(days=PRE_SEASON_LEAD_DAYS) if expected_rise else None
    setup_end = expected_rise - timedelta(days=ALERT_LEAD_DAYS) if expected_rise else None

    return SeasonAssessment(
        product_category=category,
        as_of=as_of,
        state=state,
        demand_index=ratio,
        yoy_index=yoy_index,
        expected_rise_date=expected_rise,
        recommended_setup_start=setup_start,
        recommended_setup_end=setup_end,
        evidence={
            "method": "OBSERVED_DEMAND",
            "history_days": history_days,
            "span_days": span_days,
            "window_days": WINDOW_DAYS,
            "current_window_impressions": round(current, 1),
            "previous_window_impressions": round(previous, 1),
            "trend": round(trend, 3) if trend is not None else None,
        },
    )


def _expected_rise_from_history(series: dict[date, float], as_of: date) -> date | None:
    """작년에 본격 상승이 시작된 날짜를 올해로 투영한다."""
    last_year_days = sorted(d for d in series if d.year == as_of.year - 1)
    if len(last_year_days) < 60:
        return None
    values = [(day, _window_sum(series, day)) for day in last_year_days]
    peak_value = max(v for _, v in values) or 1.0
    for day, value in values:
        if value >= peak_value * RISING_RATIO:
            projected = day.replace(year=day.year + 1)
            return projected if projected > as_of else None
    return None


def refresh_indices(db: Session, as_of: date) -> list[SeasonAssessment]:
    """전 상품군 시즌 상태를 계산해 season_indices 에 저장한다."""
    assessments: list[SeasonAssessment] = []
    for row in db.scalars(select(ProductCategoryRow)):
        assessment = assess(db, row.code, as_of)
        assessments.append(assessment)
        existing = db.scalar(
            select(SeasonIndex).where(
                SeasonIndex.product_category == row.code, SeasonIndex.as_of_date == as_of
            )
        )
        index = existing or SeasonIndex(product_category=row.code, as_of_date=as_of)
        index.demand_index = assessment.demand_index
        index.yoy_index = assessment.yoy_index
        index.state = assessment.state
        index.expected_rise_date = assessment.expected_rise_date
        index.recommended_setup_start = assessment.recommended_setup_start
        index.recommended_setup_end = assessment.recommended_setup_end
        index.evidence = assessment.evidence
        if existing is None:
            db.add(index)
    db.commit()
    return assessments


def upcoming_season_alerts(assessments: list[SeasonAssessment], as_of: date) -> list[dict]:
    """상승 예상 14일 전 사전 알림 (§20)."""
    alerts = []
    for assessment in assessments:
        rise = assessment.expected_rise_date
        if not rise:
            continue
        days_left = (rise - as_of).days
        if ALERT_LEAD_DAYS <= days_left <= PRE_SEASON_LEAD_DAYS:
            alerts.append(
                {
                    "product_category": assessment.product_category,
                    "expected_rise_date": rise.isoformat(),
                    "days_left": days_left,
                    "recommended_setup": [
                        assessment.recommended_setup_start.isoformat() if assessment.recommended_setup_start else None,
                        assessment.recommended_setup_end.isoformat() if assessment.recommended_setup_end else None,
                    ],
                    "message": (
                        f"{assessment.product_category} 예상 상승 {rise.isoformat()} (D-{days_left}) — "
                        f"광고세팅 권장 구간에 진입했습니다."
                    ),
                }
            )
    return alerts
