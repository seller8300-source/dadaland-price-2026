"""STEP 2 — Data Quality Validator (§8–9)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import TrustStatus
from app.demo import dataset as synthetic
from app.models import Account, DataQualityWarning, HistoricalImport, KeywordStatDaily
from app.services.quality.rules import has_template_string
from app.services.quality.validator import validate


def _stat(db: Session, account: Account, **kwargs) -> KeywordStatDaily:
    defaults = dict(
        account_id=account.id,
        stat_date=date(2026, 3, 2),
        keyword_text="이동식에어컨렌탈",
        impressions=100,
        clicks=5,
        cost=7_500.0,
        product_category="냉방",
        trust_status=TrustStatus.UNVERIFIED,
    )
    defaults.update(kwargs)
    stat = KeywordStatDaily(**defaults)
    db.add(stat)
    db.commit()
    return stat


def test_template_string_detection() -> None:
    """§9 키워드 상세 — 값 영역에 템플릿 문자열이 남아 있는 경우."""
    assert has_template_string("{{avg_rank}}")
    assert has_template_string("#REF!")
    assert has_template_string("평균순위")
    assert not has_template_string("2.4")
    assert not has_template_string("")


def test_rows_start_unverified_and_get_promoted(db: Session) -> None:
    """적재 직후에는 UNVERIFIED, 검증을 통과해야 TRUSTED (§8)."""
    account = db.scalar(select(Account).where(Account.name == "다다그룹"))
    stat = _stat(db, account)
    assert stat.trust_status == TrustStatus.UNVERIFIED

    validate(db)
    db.refresh(stat)
    assert stat.trust_status == TrustStatus.TRUSTED


def test_impossible_metrics_are_rejected(db: Session) -> None:
    account = db.scalar(select(Account).where(Account.name == "다다그룹"))
    clicks_over_impressions = _stat(db, account, impressions=10, clicks=50)
    cost_without_clicks = _stat(db, account, keyword_text="난방기렌탈", clicks=0, cost=50_000.0)

    validate(db)
    db.refresh(clicks_over_impressions)
    db.refresh(cost_without_clicks)
    assert clicks_over_impressions.trust_status == TrustStatus.REJECTED
    assert cost_without_clicks.trust_status == TrustStatus.REJECTED


def test_template_string_row_is_rejected(db: Session) -> None:
    account = db.scalar(select(Account).where(Account.name == "다다그룹"))
    stat = _stat(db, account, raw_row={"평균순위": "{{avg_rank}}", "키워드": "이동식에어컨렌탈"})
    validate(db)
    db.refresh(stat)
    assert stat.trust_status == TrustStatus.REJECTED


def test_cost_copy_between_accounts_is_blocked(db: Session) -> None:
    """§9 으라차차 — 키워드 비용값이 MBC렌탈과 동일 패턴으로 복사된 문제."""
    synthetic.generate(db)
    copied = synthetic.inject_cost_copy_defect(db)
    assert copied >= 10

    report = validate(db)
    codes = {finding.rule_code for finding in report.blocking_findings}
    assert "COST_PATTERN_COPIED_BETWEEN_ACCOUNTS" in codes

    warnings = db.scalars(
        select(DataQualityWarning).where(
            DataQualityWarning.rule_code == "COST_PATTERN_COPIED_BETWEEN_ACCOUNTS"
        )
    ).all()
    warned_accounts = {
        db.get(Account, warning.account_id).name for warning in warnings if warning.account_id
    }
    assert {"으라차차", "MBC렌탈"} <= warned_accounts

    rejected = db.scalars(
        select(KeywordStatDaily).where(KeywordStatDaily.trust_status == TrustStatus.REJECTED)
    ).all()
    assert rejected, "복사된 행이 분석에서 제외되지 않았습니다."
    # 복사된 키워드만 제외되고 계정 전체가 버려지지는 않는다.
    assert {row.keyword_text for row in rejected} == {"난방기렌탈", "행사집기렌탈"}


def test_cross_account_sheet_duplication_blocks_import(db: Session) -> None:
    """§9 전환수 시트 — 여러 계정에 동일 데이터가 복사된 시트는 사용 금지."""
    accounts = [
        db.scalar(select(Account).where(Account.name == name)) for name in ("다다그룹", "타임렌탈")
    ]
    fingerprints = [f"fingerprint-{index}" for index in range(40)]
    for account in accounts:
        db.add(
            HistoricalImport(
                account_id=account.id,
                file_name=f"{account.name}_2026.xlsx",
                sheet_name="전환수",
                row_count=40,
                summary={"row_fingerprints": fingerprints},
            )
        )
    db.commit()

    report = validate(db)
    codes = {finding.rule_code for finding in report.blocking_findings}
    assert "CONVERSION_SHEET_UNUSABLE" in codes

    statuses = {record.trust_status for record in db.scalars(select(HistoricalImport))}
    assert TrustStatus.REJECTED in statuses


def test_campaign_label_mismatch_is_reported(db: Session) -> None:
    """§9 캠페인 라벨 오류 — 캠페인명을 상품분류의 근거로 쓰지 않는 이유."""
    synthetic.generate(db)
    report = validate(db)
    codes = {finding.rule_code for finding in report.findings}
    assert "CAMPAIGN_LABEL_MISMATCH" in codes
    # 라벨 불일치는 경고일 뿐, 데이터를 버리지는 않는다.
    mismatch = [f for f in report.findings if f.rule_code == "CAMPAIGN_LABEL_MISMATCH"]
    assert all(not f.blocks_analysis for f in mismatch)
