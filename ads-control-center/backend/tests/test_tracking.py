"""STEP 0 — 전환추적 (§7)."""
from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import ConversionType, TrustStatus
from app.models import Account, Keyword, KeywordStatDaily
from app.services.conversion import tracking


def _prepare_keyword(db: Session, account_name: str = "타임렌탈") -> Keyword:
    account = db.scalar(select(Account).where(Account.name == account_name))
    keyword = Keyword(
        account_id=account.id,
        text="인천 이동식에어컨렌탈",
        normalized_text="인천이동식에어컨렌탈",
    )
    db.add(keyword)
    db.add(
        KeywordStatDaily(
            account_id=account.id,
            stat_date=date(2026, 7, 1),
            keyword_text="인천 이동식에어컨렌탈",
            impressions=1_000,
            clicks=100,
            cost=150_000,
            product_category="냉방",
            trust_status=TrustStatus.TRUSTED,
        )
    )
    db.commit()
    return keyword


def test_naver_url_params_attribute_to_keyword(db: Session) -> None:
    keyword = _prepare_keyword(db)
    event = tracking.TrackedEvent(
        conversion_type=ConversionType.QUOTE_REQUEST,
        account_name="타임렌탈",
        landing_url="https://timerental.co.kr/quote?n_keyword=인천 이동식에어컨렌탈&n_query=인천에어컨렌탈&n_rank=2",
        visitor_id="v-1",
        occurred_at=datetime(2026, 7, 1, 10, 0, tzinfo=UTC),
    )
    conversion = tracking.record_event(db, event)
    assert conversion.keyword_id == keyword.id
    assert conversion.attribution_method == "NAVER_URL_PARAM"
    assert conversion.attribution_confidence == 95.0
    assert conversion.search_term == "인천에어컨렌탈"


def test_phone_click_inherits_previous_touch(db: Session) -> None:
    """렌탈은 전화문의 비중이 크다 — 직전 광고 유입에서 키워드를 상속한다."""
    _prepare_keyword(db)
    tracking.record_event(
        db,
        tracking.TrackedEvent(
            conversion_type=ConversionType.PHONE_CLICK,
            account_name="타임렌탈",
            landing_url="https://timerental.co.kr/?n_keyword=인천 이동식에어컨렌탈",
            visitor_id="v-2",
            occurred_at=datetime(2026, 7, 2, 9, 0, tzinfo=UTC),
        ),
    )
    later = tracking.record_event(
        db,
        tracking.TrackedEvent(
            conversion_type=ConversionType.CALL_CONNECTED,
            visitor_id="v-2",
            call_seconds=180,
            occurred_at=datetime(2026, 7, 2, 9, 5, tzinfo=UTC),
        ),
    )
    assert later.keyword_text == "인천 이동식에어컨렌탈"
    assert later.attribution_method == "PREVIOUS_TOUCH"


def test_unattributed_event_is_marked_not_guessed(db: Session) -> None:
    conversion = tracking.record_event(
        db,
        tracking.TrackedEvent(
            conversion_type=ConversionType.KAKAO_INQUIRY,
            visitor_id="v-3",
            occurred_at=datetime(2026, 7, 3, 12, 0, tzinfo=UTC),
        ),
    )
    assert conversion.attribution_method == "UNATTRIBUTED"
    assert conversion.attribution_confidence == 0.0
    assert conversion.keyword_id is None


def test_funnel_chain(db: Session) -> None:
    """KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE."""
    _prepare_keyword(db)
    landing = "https://timerental.co.kr/?n_keyword=인천 이동식에어컨렌탈"
    base = datetime(2026, 7, 1, 11, tzinfo=UTC)
    for conversion_type, value in (
        (ConversionType.CONSULT_REQUEST, 0),
        (ConversionType.QUOTE_REQUEST, 0),
        (ConversionType.CONTRACT, 2_400_000),
    ):
        tracking.record_event(
            db,
            tracking.TrackedEvent(
                conversion_type=conversion_type,
                account_name="타임렌탈",
                landing_url=landing,
                lead_id="lead-1",
                visitor_id="v-4",
                value=value,
                occurred_at=base,
            ),
        )

    result = tracking.funnel(db, date(2026, 7, 1), date(2026, 7, 31))
    assert result["clicks"] == 100
    assert result["inquiries"] == 1
    assert result["quotes"] == 1
    assert result["contracts"] == 1
    assert result["revenue"] == 2_400_000
    assert result["cost_per_contract"] == 150_000
    assert result["status"] == "OK"


def test_funnel_reports_data_insufficient_when_empty(db: Session) -> None:
    result = tracking.funnel(db, date(2026, 7, 1), date(2026, 7, 31))
    assert result["status"].startswith("DATA INSUFFICIENT")


def test_coverage_lists_accounts_without_tracking(db: Session) -> None:
    _prepare_keyword(db)
    tracking.record_event(
        db,
        tracking.TrackedEvent(
            conversion_type=ConversionType.QUOTE_REQUEST,
            account_name="타임렌탈",
            landing_url="https://timerental.co.kr/?n_keyword=인천 이동식에어컨렌탈",
            occurred_at=datetime(2026, 7, 1, 10, tzinfo=UTC),
        ),
    )
    status = tracking.coverage(db, date(2026, 7, 1), date(2026, 7, 31))
    assert status["total_accounts"] == 10
    assert status["installed_accounts"] == 1
    not_installed = [row["account"] for row in status["accounts"] if not row["installed"]]
    assert "현대도크" in not_installed
