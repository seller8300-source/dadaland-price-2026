"""매출 생산성 (§25) 과 광고비 대비 필요 매출 (§26)."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import TrustStatus
from app.models import Account, KeywordStatDaily, SalesDaily
from app.services.productivity.revenue import (
    Verdict,
    account_productivity,
    breakeven_scenarios,
    margin_rate_for,
)

BASE = (date(2025, 1, 1), date(2025, 8, 31))
COMP = (date(2026, 1, 1), date(2026, 8, 31))


def _spend(db: Session, account: Account, day: date, cost: float) -> None:
    db.add(
        KeywordStatDaily(
            account_id=account.id,
            stat_date=day,
            keyword_text="이동식에어컨렌탈",
            impressions=1_000,
            clicks=100,
            cost=cost,
            product_category="냉방",
            trust_status=TrustStatus.TRUSTED,
        )
    )


def _sales(db: Session, account: Account, day: date, revenue: float, profit: float | None = None) -> None:
    db.add(
        SalesDaily(account_id=account.id, sale_date=day, revenue=revenue, contribution_profit=profit)
    )


def _setup(db: Session, name: str, cost_before: float, cost_after: float,
           revenue_before: float, revenue_after: float) -> Account:
    account = db.scalar(select(Account).where(Account.name == name))
    _spend(db, account, date(2025, 5, 1), cost_before)
    _spend(db, account, date(2026, 5, 1), cost_after)
    _sales(db, account, date(2025, 5, 1), revenue_before, revenue_before * 0.3)
    _sales(db, account, date(2026, 5, 1), revenue_after, revenue_after * 0.3)
    db.commit()
    return account


def test_cost_up_20_revenue_up_45_is_improvement(db: Session) -> None:
    account = _setup(db, "다다그룹", 10_000_000, 12_000_000, 50_000_000, 72_500_000)
    row = account_productivity(db, account, BASE, COMP)
    assert row.cost_change_pct == pytest.approx(20)
    assert row.revenue_change_pct == pytest.approx(45)
    assert row.verdict == Verdict.IMPROVED


def test_cost_up_70_revenue_up_20_is_productivity_drop(db: Session) -> None:
    account = _setup(db, "OMBC", 10_000_000, 17_000_000, 50_000_000, 60_000_000)
    row = account_productivity(db, account, BASE, COMP)
    assert row.verdict == Verdict.REVENUE_UP_PRODUCTIVITY_DOWN


def test_cost_up_300_revenue_up_5_needs_investigation(db: Session) -> None:
    account = _setup(db, "마니", 5_000_000, 20_000_000, 50_000_000, 52_500_000)
    row = account_productivity(db, account, BASE, COMP)
    assert row.verdict == Verdict.INVESTIGATE_NOW


def test_without_sales_data_no_efficiency_verdict(db: Session) -> None:
    """매출이 없으면 광고비 증감만으로 효율을 판정하지 않는다 (§11, §40)."""
    account = db.scalar(select(Account).where(Account.name == "킴샵"))
    _spend(db, account, date(2025, 5, 1), 3_000_000)
    _spend(db, account, date(2026, 5, 1), 9_000_000)
    db.commit()

    row = account_productivity(db, account, BASE, COMP)
    assert row.verdict == Verdict.DATA_INSUFFICIENT
    assert any("DATA INSUFFICIENT" in text or "판정하지 않는다" in text for text in row.notes)


def test_growth_account_gets_growth_note(db: Session) -> None:
    account = _setup(db, "타임렌탈", 9_500_000, 28_900_000, 40_000_000, 90_000_000)
    row = account_productivity(db, account, BASE, COMP)
    assert row.is_growth_account is True
    assert any("성장효율 유지가 우선" in note for note in row.notes)


def test_breakeven_scenarios(db: Session) -> None:
    """§26 — 광고비 1억, 기여마진율 30% → 절대 손익분기 약 3.33억."""
    result = breakeven_scenarios(100_000_000, 0.30)
    assert result["absolute_breakeven_revenue"] == pytest.approx(333_333_333, rel=1e-6)
    by_ratio = {s["target_ad_cost_ratio_pct"]: s["required_revenue"] for s in result["scenarios"]}
    assert by_ratio[20.0] == pytest.approx(500_000_000)
    assert by_ratio[15.0] == pytest.approx(666_666_667, rel=1e-6)
    assert by_ratio[10.0] == pytest.approx(1_000_000_000)


def test_margin_rate_prefers_account_setting(db: Session) -> None:
    account = db.scalar(select(Account).where(Account.name == "현대도크"))
    assert margin_rate_for(db, account) == 0.30  # 기본값 (business_rules)
    account.contribution_margin_rate = 0.42
    db.commit()
    assert margin_rate_for(db, account) == 0.42
