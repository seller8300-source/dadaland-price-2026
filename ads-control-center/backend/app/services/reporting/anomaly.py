"""이상징후 탐지 (§27).

CPC 급등 / CTR 급락 / 평균순위 과다 / 비시즌 광고 / 생산성 저하.
모든 탐지는 '확인하라' 는 신호이지 '삭감하라' 는 결론이 아니다 (§11).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import AlertLevel, AlertType, SeasonState
from app.models import Account, Alert
from app.services.benchmark.metrics import pct_change, period_metrics
from app.services.season.predictor import assess as assess_season

CPC_SPIKE_PCT = 20.0
CTR_DROP_PCT = -20.0
COST_JUMP_PCT = 25.0
RANK_TOO_HIGH = 1.3          # 평균순위가 1.3위보다 앞이면 과다 상위입찰 의심
OFF_SEASON_MIN_COST = 300_000.0


@dataclass(slots=True)
class Anomaly:
    account_id: int | None
    account_name: str
    alert_type: str
    level: str
    title: str
    message: str
    evidence: dict = field(default_factory=dict)
    product_category: str | None = None

    def as_dict(self) -> dict:
        return {
            "account": self.account_name,
            "type": self.alert_type,
            "level": self.level,
            "title": self.title,
            "message": self.message,
            "product_category": self.product_category,
            "evidence": self.evidence,
        }


def detect(db: Session, as_of: date, lookback_days: int = 7) -> list[Anomaly]:
    """어제 실적을 직전 7일 평균과 비교한다."""
    anomalies: list[Anomaly] = []
    baseline_end = as_of - timedelta(days=1)
    baseline_start = as_of - timedelta(days=lookback_days)

    for account in db.scalars(select(Account).where(Account.is_active.is_(True))):
        today = period_metrics(db, as_of, as_of, account.id)
        if today.clicks == 0 and today.cost == 0:
            continue
        baseline = period_metrics(db, baseline_start, baseline_end, account.id)
        days = max((baseline_end - baseline_start).days + 1, 1)
        baseline_daily_cost = baseline.cost / days

        cpc_change = pct_change(baseline.cpc, today.cpc)
        ctr_change = pct_change(baseline.ctr, today.ctr)
        cost_change = pct_change(baseline_daily_cost, today.cost)
        click_change = pct_change(baseline.clicks / days if baseline.clicks else None, today.clicks)

        if cpc_change is not None and cpc_change >= CPC_SPIKE_PCT:
            level = AlertLevel.WARNING if cpc_change >= CPC_SPIKE_PCT * 2 else AlertLevel.WATCH
            anomalies.append(
                Anomaly(
                    account.id,
                    account.name,
                    AlertType.CPC_SPIKE,
                    level,
                    f"{account.name} CPC {cpc_change:+.0f}%",
                    f"CPC {cpc_change:+.0f}%, 클릭 {click_change:+.0f}%, 비용 {cost_change:+.0f}% "
                    f"→ 입찰/순위 점검"
                    if click_change is not None and cost_change is not None
                    else f"CPC {cpc_change:+.0f}% → 입찰/순위 점검",
                    {
                        "cpc_before": round(baseline.cpc, 1) if baseline.cpc else None,
                        "cpc_after": round(today.cpc, 1) if today.cpc else None,
                        "click_change_pct": round(click_change, 1) if click_change is not None else None,
                        "cost_change_pct": round(cost_change, 1) if cost_change is not None else None,
                    },
                )
            )

        if ctr_change is not None and ctr_change <= CTR_DROP_PCT:
            anomalies.append(
                Anomaly(
                    account.id,
                    account.name,
                    AlertType.CTR_DROP,
                    AlertLevel.WATCH,
                    f"{account.name} CTR {ctr_change:+.0f}%",
                    "CTR 급락 — 소재/랜딩/실제 검색어를 확인한다.",
                    {
                        "ctr_before": round(baseline.ctr, 2) if baseline.ctr else None,
                        "ctr_after": round(today.ctr, 2) if today.ctr else None,
                    },
                )
            )

        if today.average_rank is not None and today.average_rank <= RANK_TOO_HIGH and today.cost > 0:
            anomalies.append(
                Anomaly(
                    account.id,
                    account.name,
                    AlertType.RANK_OVERSPEND,
                    AlertLevel.WATCH,
                    f"{account.name} 평균순위 {today.average_rank:.1f}위",
                    "상위 고정운영 가능성 — 순위를 낮췄을 때 전환 차이가 있는지 비교한다 (§13).",
                    {"average_rank": round(today.average_rank, 2), "cost": round(today.cost, 1)},
                )
            )

        if cost_change is not None and cost_change >= COST_JUMP_PCT and (cpc_change or 0) >= CPC_SPIKE_PCT:
            anomalies.append(
                Anomaly(
                    account.id,
                    account.name,
                    AlertType.EFFICIENCY_WARNING,
                    AlertLevel.WARNING,
                    f"{account.name} 비용 {cost_change:+.0f}% (CPC 주도)",
                    "비용 증가가 클릭이 아니라 CPC 에서 발생했다. 고CPC 키워드부터 확인한다.",
                    {"cost_change_pct": round(cost_change, 1), "cpc_change_pct": round(cpc_change, 1)},
                )
            )

    anomalies.extend(_off_season_spend(db, as_of))
    return anomalies


def _off_season_spend(db: Session, as_of: date) -> list[Anomaly]:
    """비시즌 상품군에 큰 광고비가 나가고 있는지 (§21)."""
    from app.services.benchmark.metrics import category_breakdown

    anomalies: list[Anomaly] = []
    month_start = as_of.replace(day=1)
    season_cache: dict[str, object] = {}
    for account in db.scalars(select(Account).where(Account.is_active.is_(True))):
        breakdown = category_breakdown(db, month_start, as_of, account.id)
        for category, values in breakdown.items():
            if values["cost"] < OFF_SEASON_MIN_COST:
                continue
            if category not in season_cache:
                season_cache[category] = assess_season(db, category, as_of)
            season = season_cache[category]
            if season.state == SeasonState.OFF_SEASON:
                anomalies.append(
                    Anomaly(
                        account.id,
                        account.name,
                        AlertType.OFF_SEASON_SPEND,
                        AlertLevel.WATCH,
                        f"{account.name} 비시즌 {category} 광고비 {values['cost']:,.0f}원",
                        "비시즌 상품군에 광고비가 집행 중이다. 필수키워드 외 유지 여부를 검토한다 (§21).",
                        {"category": category, "cost": values["cost"], "season_state": season.state,
                         "season_evidence": season.evidence},
                        product_category=category,
                    )
                )
    return anomalies


def persist(db: Session, anomalies: list[Anomaly], as_of: date) -> list[Alert]:
    """탐지 결과를 alerts 테이블에 반영한다 (같은 날 같은 유형은 갱신)."""
    stored: list[Alert] = []
    for anomaly in anomalies:
        existing = db.scalar(
            select(Alert).where(
                Alert.account_id == anomaly.account_id,
                Alert.as_of_date == as_of,
                Alert.alert_type == anomaly.alert_type,
                Alert.product_category.is_(None)
                if anomaly.product_category is None
                else Alert.product_category == anomaly.product_category,
            )
        )
        alert = existing or Alert(
            account_id=anomaly.account_id,
            as_of_date=as_of,
            alert_type=anomaly.alert_type,
            product_category=anomaly.product_category,
        )
        alert.level = anomaly.level
        alert.title = anomaly.title
        alert.message = anomaly.message
        alert.evidence = anomaly.evidence
        if existing is None:
            db.add(alert)
        stored.append(alert)
    db.commit()
    return stored
