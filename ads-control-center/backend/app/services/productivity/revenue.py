"""매출 생산성 분석 (§25) + 광고비 대비 필요 매출 (§26).

이 모듈이 시스템의 최상위 분석 영역이다.
광고비 증감은 그 자체로 좋고 나쁨이 아니다 — 항상 매출/기여이익 증감과 함께 본다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Account, BusinessRule, SalesDaily
from app.services.benchmark.metrics import pct_change, period_metrics

DEFAULT_TARGET_AD_COST_RATIOS = (0.20, 0.15, 0.10)
# 광고비 증가율이 매출 증가율의 이 배수를 넘으면 즉시 원인분석 (§25)
INVESTIGATION_RATIO = 5.0


class Verdict:
    IMPROVED = "PRODUCTIVITY_IMPROVED"
    REVENUE_UP_PRODUCTIVITY_DOWN = "REVENUE_UP_PRODUCTIVITY_DOWN"
    INVESTIGATE_NOW = "INVESTIGATE_NOW"
    COST_DOWN_REVENUE_DOWN = "COST_DOWN_REVENUE_DOWN"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


VERDICT_TEXT = {
    Verdict.IMPROVED: "생산성 개선 — 광고비보다 매출이 빠르게 증가",
    Verdict.REVENUE_UP_PRODUCTIVITY_DOWN: "매출은 늘었지만 광고생산성 저하",
    Verdict.INVESTIGATE_NOW: "즉시 원인분석 — 광고비 증가 대비 매출 반응이 없음",
    Verdict.COST_DOWN_REVENUE_DOWN: "광고비와 매출이 함께 감소 — 수요 축소인지 노출 축소인지 확인",
    Verdict.DATA_INSUFFICIENT: "DATA INSUFFICIENT — 매출 데이터가 없어 생산성 판단 불가",
}


@dataclass(slots=True)
class ProductivityRow:
    account_id: int | None
    account_name: str
    is_growth_account: bool
    cost_before: float
    cost_after: float
    revenue_before: float
    revenue_after: float
    profit_before: float | None
    profit_after: float | None
    cost_change_pct: float | None
    revenue_change_pct: float | None
    profit_change_pct: float | None
    ad_cost_ratio_before: float | None
    ad_cost_ratio_after: float | None
    verdict: str
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "account": self.account_name,
            "is_growth_account": self.is_growth_account,
            "cost_before": round(self.cost_before, 1),
            "cost_after": round(self.cost_after, 1),
            "revenue_before": round(self.revenue_before, 1),
            "revenue_after": round(self.revenue_after, 1),
            "contribution_profit_before": round(self.profit_before, 1) if self.profit_before is not None else None,
            "contribution_profit_after": round(self.profit_after, 1) if self.profit_after is not None else None,
            "cost_change_pct": round(self.cost_change_pct, 1) if self.cost_change_pct is not None else None,
            "revenue_change_pct": round(self.revenue_change_pct, 1) if self.revenue_change_pct is not None else None,
            "profit_change_pct": round(self.profit_change_pct, 1) if self.profit_change_pct is not None else None,
            "ad_cost_ratio_before": round(self.ad_cost_ratio_before * 100, 1) if self.ad_cost_ratio_before else None,
            "ad_cost_ratio_after": round(self.ad_cost_ratio_after * 100, 1) if self.ad_cost_ratio_after else None,
            "verdict": self.verdict,
            "verdict_text": VERDICT_TEXT[self.verdict],
            "notes": self.notes,
        }


def _sales(db: Session, account_id: int | None, start: date, end: date) -> tuple[float, float | None]:
    conditions = [SalesDaily.sale_date >= start, SalesDaily.sale_date <= end]
    if account_id is not None:
        conditions.append(SalesDaily.account_id == account_id)
    revenue, profit = db.execute(
        select(func.sum(SalesDaily.revenue), func.sum(SalesDaily.contribution_profit)).where(
            and_(*conditions)
        )
    ).one()
    return float(revenue or 0.0), (float(profit) if profit is not None else None)


def _verdict(cost_change: float | None, revenue_change: float | None, has_revenue: bool) -> str:
    if not has_revenue or revenue_change is None or cost_change is None:
        return Verdict.DATA_INSUFFICIENT
    if cost_change <= 0 and revenue_change <= 0:
        return Verdict.COST_DOWN_REVENUE_DOWN
    if revenue_change >= cost_change:
        return Verdict.IMPROVED
    if revenue_change > 0 and cost_change > revenue_change:
        # 매출은 늘었으나 광고비가 더 빨리 늘었다.
        # 광고비 +70% / 매출 +20% 는 '생산성 저하', +300% / +5% 는 '즉시 원인분석' (§25).
        if cost_change >= revenue_change * INVESTIGATION_RATIO:
            return Verdict.INVESTIGATE_NOW
        return Verdict.REVENUE_UP_PRODUCTIVITY_DOWN
    return Verdict.INVESTIGATE_NOW


def account_productivity(
    db: Session,
    account: Account | None,
    base_period: tuple[date, date],
    comp_period: tuple[date, date],
) -> ProductivityRow:
    account_id = account.id if account else None
    name = account.name if account else "회사 전체"

    cost_before = period_metrics(db, base_period[0], base_period[1], account_id).cost
    cost_after = period_metrics(db, comp_period[0], comp_period[1], account_id).cost
    revenue_before, profit_before = _sales(db, account_id, *base_period)
    revenue_after, profit_after = _sales(db, account_id, *comp_period)

    cost_change = pct_change(cost_before, cost_after)
    revenue_change = pct_change(revenue_before, revenue_after)
    profit_change = pct_change(profit_before or 0.0, profit_after or 0.0) if profit_before else None
    has_revenue = revenue_before > 0 or revenue_after > 0

    row = ProductivityRow(
        account_id=account_id,
        account_name=name,
        is_growth_account=bool(account and account.is_growth_account),
        cost_before=cost_before,
        cost_after=cost_after,
        revenue_before=revenue_before,
        revenue_after=revenue_after,
        profit_before=profit_before,
        profit_after=profit_after,
        cost_change_pct=cost_change,
        revenue_change_pct=revenue_change,
        profit_change_pct=profit_change,
        ad_cost_ratio_before=(cost_before / revenue_before) if revenue_before else None,
        ad_cost_ratio_after=(cost_after / revenue_after) if revenue_after else None,
        verdict=_verdict(cost_change, revenue_change, has_revenue),
    )

    if row.verdict == Verdict.DATA_INSUFFICIENT:
        row.notes.append(
            "매출 데이터가 연동되지 않아 광고비 증감만으로 효율을 판정하지 않는다 (§11, §40)."
        )
    if account and account.is_growth_account:
        row.notes.append("성장계정 — 비용절감보다 성장효율 유지가 우선이다 (§6).")
    return row


def company_productivity(
    db: Session, base_period: tuple[date, date], comp_period: tuple[date, date]
) -> list[ProductivityRow]:
    rows = [account_productivity(db, None, base_period, comp_period)]
    for account in db.scalars(select(Account).where(Account.is_active.is_(True))):
        rows.append(account_productivity(db, account, base_period, comp_period))
    return rows


def margin_rate_for(db: Session, account: Account | None) -> float:
    if account and account.contribution_margin_rate:
        return float(account.contribution_margin_rate)
    rule = db.scalar(select(BusinessRule).where(BusinessRule.code == "DEFAULT_CONTRIBUTION_MARGIN"))
    if rule and rule.params and rule.params.get("contribution_margin_rate"):
        return float(rule.params["contribution_margin_rate"])
    return settings.default_contribution_margin_rate


def breakeven_scenarios(
    ad_cost: float,
    margin_rate: float,
    target_ratios: tuple[float, ...] = DEFAULT_TARGET_AD_COST_RATIOS,
) -> dict:
    """광고비 손익분기 매출과 실무 목표 시나리오 (§26).

    절대 손익분기 = 광고비 / 기여마진율.
    실무 목표는 '광고비율' 시나리오로 별도 표시한다.
    """
    if margin_rate <= 0:
        return {"error": "DATA INSUFFICIENT — 기여마진율이 설정되지 않았습니다."}
    return {
        "ad_cost": round(ad_cost, 1),
        "contribution_margin_rate": margin_rate,
        "absolute_breakeven_revenue": round(ad_cost / margin_rate, 1),
        "scenarios": [
            {
                "target_ad_cost_ratio_pct": round(ratio * 100, 1),
                "required_revenue": round(ad_cost / ratio, 1),
            }
            for ratio in target_ratios
        ],
    }


def month_projection(db: Session, account_id: int | None, today: date) -> dict:
    """이번달 누적과 월말 예상 (§27)."""
    month_start = today.replace(day=1)
    if today.month == 12:
        next_month = date(today.year + 1, 1, 1)
    else:
        next_month = date(today.year, today.month + 1, 1)
    days_in_month = (next_month - month_start).days
    elapsed_days = (today - month_start).days + 1

    mtd = period_metrics(db, month_start, today, account_id).cost
    projected = mtd / elapsed_days * days_in_month if elapsed_days else 0.0
    return {
        "month_to_date_cost": round(mtd, 1),
        "elapsed_days": elapsed_days,
        "days_in_month": days_in_month,
        "projected_month_cost": round(projected, 1),
    }
