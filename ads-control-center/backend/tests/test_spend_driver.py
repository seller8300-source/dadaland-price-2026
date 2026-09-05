"""§12 — 광고비 증가 원인 분해."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import SpendDriver, TrustStatus
from app.models import Account, KeywordStatDaily
from app.services.benchmark.metrics import Metrics
from app.services.benchmark.spend_driver import decompose, explain_cost_change, one_sentence


def _metrics(cost: float, clicks: int, impressions: int, campaigns: int = 1) -> Metrics:
    return Metrics(cost=cost, clicks=clicks, impressions=impressions, campaign_count=campaigns)


def test_click_driven_increase() -> None:
    result = decompose(_metrics(1_000_000, 1_000, 20_000), _metrics(2_000_000, 2_000, 40_000))
    assert result.primary_driver == SpendDriver.A_CLICK_GROWTH
    assert result.click_effect == pytest.approx(1_000_000)
    assert result.cpc_effect == pytest.approx(0)


def test_cpc_driven_increase() -> None:
    result = decompose(_metrics(1_000_000, 1_000, 20_000), _metrics(2_000_000, 1_000, 20_000))
    assert result.primary_driver == SpendDriver.B_CPC_RISE
    assert result.cpc_effect == pytest.approx(1_000_000)


def test_both_drivers() -> None:
    result = decompose(_metrics(1_000_000, 1_000, 20_000), _metrics(2_250_000, 1_500, 30_000))
    assert result.primary_driver == SpendDriver.C_CLICK_AND_CPC
    total = result.click_effect + result.cpc_effect + result.interaction_effect
    assert total == pytest.approx(result.cost_delta)


def test_rank_push_is_secondary_driver() -> None:
    before = Metrics(cost=1_000_000, clicks=1_000, impressions=20_000,
                     rank_weighted_sum=3_000, rank_weight=1_000)
    after = Metrics(cost=2_000_000, clicks=1_000, impressions=20_000,
                    rank_weighted_sum=1_200, rank_weight=1_000)
    result = decompose(before, after)
    assert SpendDriver.D_RANK_PUSH in result.secondary_drivers


def test_campaign_expansion_is_secondary_driver() -> None:
    result = decompose(
        _metrics(1_000_000, 1_000, 20_000, campaigns=2),
        _metrics(2_000_000, 2_000, 40_000, campaigns=5),
    )
    assert SpendDriver.F_CAMPAIGN_EXPANSION in result.secondary_drivers


def test_inefficient_inflow_flagged_when_ctr_collapses() -> None:
    result = decompose(_metrics(1_000_000, 1_000, 20_000), _metrics(2_400_000, 1_200, 60_000))
    assert SpendDriver.H_INEFFICIENT_INFLOW in result.secondary_drivers


def test_no_baseline_is_data_insufficient() -> None:
    result = decompose(_metrics(0, 0, 0), _metrics(2_000_000, 1_000, 20_000))
    assert result.primary_driver == SpendDriver.DATA_INSUFFICIENT
    assert "DATA INSUFFICIENT" in one_sentence(result)


def test_new_keywords_share_is_reported(db: Session) -> None:
    """§12-G — 비교 구간에만 존재하는 키워드의 비용 비중."""
    account = db.scalar(select(Account).where(Account.name == "킴샵"))
    for day, keyword, cost, clicks in (
        (date(2025, 5, 1), "행사집기렌탈", 500_000, 400),
        (date(2026, 5, 1), "행사집기렌탈", 600_000, 460),
        (date(2026, 5, 1), "박람회 부스렌탈", 900_000, 700),
    ):
        db.add(
            KeywordStatDaily(
                account_id=account.id,
                stat_date=day,
                keyword_text=keyword,
                impressions=clicks * 20,
                clicks=clicks,
                cost=cost,
                product_category="행사/축제",
                trust_status=TrustStatus.TRUSTED,
            )
        )
    db.commit()

    result = explain_cost_change(
        db, date(2025, 1, 1), date(2025, 12, 31), date(2026, 1, 1), date(2026, 12, 31), account.id
    )
    assert result.new_keyword_cost == 900_000
    assert result.new_keyword_share == pytest.approx(60.0)
    assert SpendDriver.G_NEW_KEYWORDS in result.secondary_drivers
    assert "신규키워드" in result.explanation


def test_explanation_is_one_sentence(db: Session) -> None:
    result = decompose(_metrics(1_000_000, 1_000, 20_000), _metrics(2_250_000, 1_500, 30_000))
    sentence = one_sentence(result)
    assert sentence.endswith(".")
    assert sentence.count(".") == 1
