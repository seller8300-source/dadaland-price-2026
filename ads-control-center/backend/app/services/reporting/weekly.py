"""Weekly Report (§28).

회사 전체 / 팀별 / 상품군별 / 키워드별 + 매출생산성 + AI 추천성과.
지난주에 추천한 조치가 실제 효과가 있었는지까지 보여준다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import Account, KeywordStatDaily
from app.services.benchmark.metrics import category_breakdown, pct_change, period_metrics
from app.services.benchmark.spend_driver import explain_cost_change
from app.services.competition import measure as competition
from app.services.productivity import revenue as productivity
from app.services.quality.validator import trusted_stats_filter
from app.services.recommendation import tracking as recommendation_tracking


@dataclass(slots=True)
class WeeklyReport:
    week: tuple[str, str]
    previous_week: tuple[str, str]
    company: dict
    accounts: list[dict]
    categories: dict
    keywords: list[dict]
    productivity: list[dict]
    competition: dict
    recommendation_effectiveness: dict
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def _keyword_movers(
    db: Session, current: tuple[date, date], previous: tuple[date, date], limit: int = 15
) -> list[dict]:
    def costs(period: tuple[date, date]) -> dict[str, dict]:
        rows = db.execute(
            select(
                KeywordStatDaily.keyword_text,
                func.sum(KeywordStatDaily.cost),
                func.sum(KeywordStatDaily.clicks),
                func.sum(KeywordStatDaily.impressions),
                func.sum(KeywordStatDaily.conversions),
            )
            .where(
                and_(
                    KeywordStatDaily.stat_date >= period[0],
                    KeywordStatDaily.stat_date <= period[1],
                    trusted_stats_filter(),
                )
            )
            .group_by(KeywordStatDaily.keyword_text)
        ).all()
        return {
            text: {
                "cost": float(cost or 0.0),
                "clicks": int(clicks or 0),
                "impressions": int(impressions or 0),
                "conversions": int(conversions or 0),
            }
            for text, cost, clicks, impressions, conversions in rows
            if text
        }

    now, before = costs(current), costs(previous)
    movers = []
    for text, values in now.items():
        base = before.get(text, {"cost": 0.0, "clicks": 0, "impressions": 0, "conversions": 0})
        movers.append(
            {
                "keyword": text,
                "cost": round(values["cost"], 1),
                "cost_change": round(values["cost"] - base["cost"], 1),
                "cost_change_pct": round(pct_change(base["cost"], values["cost"]), 1)
                if base["cost"]
                else None,
                "clicks": values["clicks"],
                "click_change": values["clicks"] - base["clicks"],
                "cpc": round(values["cost"] / values["clicks"], 1) if values["clicks"] else None,
                "ctr": round(values["clicks"] / values["impressions"] * 100, 2)
                if values["impressions"]
                else None,
                "conversions": values["conversions"],
                "is_new": text not in before,
            }
        )
    movers.sort(key=lambda m: abs(m["cost_change"]), reverse=True)
    return movers[:limit]


def build(db: Session, week_end: date | None = None) -> WeeklyReport:
    week_end = week_end or (date.today() - timedelta(days=1))
    week_start = week_end - timedelta(days=6)
    previous_end = week_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=6)

    current = (week_start, week_end)
    previous = (previous_start, previous_end)

    company_decomposition = explain_cost_change(db, *previous, *current)
    company_now = period_metrics(db, *current)

    accounts: list[dict] = []
    for account in db.scalars(select(Account).where(Account.is_active.is_(True))):
        now = period_metrics(db, week_start, week_end, account.id)
        before = period_metrics(db, previous_start, previous_end, account.id)
        if now.cost == 0 and before.cost == 0:
            continue
        decomposition = explain_cost_change(db, *previous, *current, account_id=account.id)
        accounts.append(
            {
                "account": account.name,
                "is_growth_account": account.is_growth_account,
                "cost": round(now.cost, 1),
                "cost_change_pct": round(pct_change(before.cost, now.cost), 1) if before.cost else None,
                "clicks": now.clicks,
                "cpc": round(now.cpc, 1) if now.cpc else None,
                "ctr": round(now.ctr, 2) if now.ctr else None,
                "conversions": now.conversions,
                "primary_driver": decomposition.primary_driver,
                "explanation": decomposition.explanation,
            }
        )
    accounts.sort(key=lambda a: a["cost"], reverse=True)

    measurements = competition.measure(db, week_start, week_end)

    report = WeeklyReport(
        week=(week_start.isoformat(), week_end.isoformat()),
        previous_week=(previous_start.isoformat(), previous_end.isoformat()),
        company={
            "cost": round(company_now.cost, 1),
            "clicks": company_now.clicks,
            "cpc": round(company_now.cpc, 1) if company_now.cpc else None,
            "ctr": round(company_now.ctr, 2) if company_now.ctr else None,
            "cost_change_pct": company_decomposition.cost_change_pct,
            "explanation": company_decomposition.explanation,
        },
        accounts=accounts,
        categories=category_breakdown(db, week_start, week_end),
        keywords=_keyword_movers(db, current, previous),
        productivity=[row.as_dict() for row in productivity.company_productivity(db, previous, current)],
        competition=competition.summarize(measurements),
        recommendation_effectiveness=recommendation_tracking.effectiveness(db, previous_start),
    )
    if report.recommendation_effectiveness["status"].startswith("DATA INSUFFICIENT"):
        report.notes.append("AI 추천 성과는 추천 적용 후 최소 2주가 지나야 측정됩니다 (§29).")
    return report
