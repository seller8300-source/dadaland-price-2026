"""STEP 6 — Daily / Weekly Report (§27–28) 와 케이오 전달 메시지 (§30)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.services.reporting import daily as daily_report
from app.services.reporting import weekly as weekly_report

AS_OF = date(2026, 8, 31)


def test_daily_report_sections(seeded_db: Session) -> None:
    report = daily_report.build(seeded_db, AS_OF)
    payload = report.as_dict()

    assert payload["company"]["yesterday_cost"] > 0
    assert payload["company"]["month_to_date_cost"] > 0
    assert payload["company"]["projected_month_cost"] > 0
    assert payload["company"]["category_mix"]
    assert payload["company"]["yoy"]["explanation"]
    assert payload["company"]["breakeven"]["absolute_breakeven_revenue"] > 0
    assert "allowed_competition_spend" in payload["competition"]
    assert "reallocation_review_spend" in payload["competition"]
    assert payload["conversion_tracking"]["total_accounts"] == 10


def test_daily_report_flags_policy_violation_first(seeded_db: Session) -> None:
    """현대도크 정책위반은 최우선 확인 대상으로 올라온다 (§6, §27)."""
    report = daily_report.build(seeded_db, AS_OF)
    assert any(v["account"] == "현대도크" for v in report.policy_violations)
    top = report.priority_accounts[0]
    assert top["account"] == "현대도크"
    assert top["icon"] == "🔴"


def test_daily_report_only_shows_confident_opportunities(seeded_db: Session) -> None:
    """Confidence 70점 미만은 CEO 보고서에서 제외 (§17)."""
    report = daily_report.build(seeded_db, AS_OF)
    assert all(item["confidence"] >= 70 for item in report.opportunities)
    assert all(item["evidence_count"] >= 2 for item in report.opportunities)


def test_daily_report_marks_missing_conversion_data(seeded_db: Session) -> None:
    """전환 데이터가 없으면 DATA INSUFFICIENT 라고 명시한다 (§40)."""
    report = daily_report.build(seeded_db, AS_OF)
    assert report.conversion_tracking["funnel"]["status"].startswith("DATA INSUFFICIENT")
    assert any("전환 데이터" in note for note in report.notes)


def test_daily_text_is_readable(seeded_db: Session) -> None:
    report = daily_report.build(seeded_db, AS_OF)
    text = daily_report.render_text(report)
    for section in ("회사 전체", "우선 확인 팀", "이상징후", "Keyword Competition", "케이오마케팅 전달 권고"):
        assert section in text


def test_agency_message_from_selected_items(seeded_db: Session) -> None:
    """'1, 3, 5번 진행' → 전달 메시지 자동 작성 (§30)."""
    report = daily_report.build(seeded_db, AS_OF)
    assert report.agency_instructions
    message = daily_report.agency_message(report, [1])
    assert "다다랜드" in message
    assert report.agency_instructions[0][:20] in message
    assert "변경 전/후" in message


def test_agency_message_handles_empty_selection(seeded_db: Session) -> None:
    report = daily_report.build(seeded_db, AS_OF)
    assert daily_report.agency_message(report, []) == "선택된 항목이 없습니다."


def test_weekly_report(seeded_db: Session) -> None:
    report = weekly_report.build(seeded_db, AS_OF)
    payload = report.as_dict()
    assert payload["week"][1] == AS_OF.isoformat()
    assert payload["accounts"]
    assert payload["keywords"]
    assert payload["productivity"]
    assert payload["recommendation_effectiveness"]["status"].startswith("DATA INSUFFICIENT")
    assert any("2주" in note for note in payload["notes"])


def test_weekly_keyword_movers_flag_new_keywords(seeded_db: Session) -> None:
    report = weekly_report.build(seeded_db, AS_OF)
    assert all("keyword" in row and "cost_change" in row for row in report.keywords)
