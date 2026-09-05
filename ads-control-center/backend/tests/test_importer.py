"""STEP 1 — 케이오 Excel Import (§8, §32)."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import TrustStatus
from app.models import Account, Campaign, HistoricalImport, Keyword, KeywordStatDaily
from app.services.importer.excel_import import import_directory, import_file


def _write_workbook(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "키워드 상세"
    # 케이오 시트는 상단에 제목/기간 행이 붙어 있다 — 헤더 자동 탐지 대상.
    sheet.append(["2026년 3월 광고 리포트"])
    sheet.append([])
    sheet.append(
        ["날짜", "캠페인명", "광고그룹", "키워드", "노출수", "클릭수", "클릭률(%)",
         "평균클릭비용(VAT제외)", "총비용", "평균노출순위", "전환수"]
    )
    sheet.append(["2026-03-01", "냉방_파워링크", "이동식에어컨", "이동식에어컨렌탈",
                  1_000, 50, "5.0", "2,400원", "120,000", 2.3, 1])
    sheet.append(["2026-03-02", "냉방_파워링크", "이동식에어컨", "코끼리에어컨",
                  800, 20, "2.5", "3,000원", "60,000", 1.4, 0])
    sheet.append(["2026-03-02", "물류_파워링크", "도크", "이동식도크임대",
                  300, 12, "4.0", "2,500원", "30,000", 2.0, 0])
    sheet.append(["합계", "", "", "", 2_100, 82, "", "", "210,000", "", 1])
    workbook.save(path)


def test_import_maps_korean_headers_and_stays_unverified(db: Session, tmp_path: Path) -> None:
    path = tmp_path / "다다그룹_2026.xlsx"
    _write_workbook(path)

    result = import_file(db, path, account_name="다다그룹")
    assert result.rows_imported == 3  # '합계' 행은 제외

    stats = db.scalars(select(KeywordStatDaily)).all()
    assert len(stats) == 3
    assert all(stat.trust_status == TrustStatus.UNVERIFIED for stat in stats)

    cooling = next(s for s in stats if s.keyword_text == "이동식에어컨렌탈")
    assert cooling.stat_date == date(2026, 3, 1)
    assert cooling.impressions == 1_000
    assert cooling.clicks == 50
    assert cooling.cost == 120_000
    assert cooling.average_rank == 2.3
    assert cooling.product_category == "냉방"
    assert cooling.raw_row["총비용"] == "120,000"


def test_import_classifies_by_keyword_not_campaign(db: Session, tmp_path: Path) -> None:
    """캠페인명이 아니라 키워드 문자열로 상품군을 정한다 (§9–10)."""
    path = tmp_path / "현대도크_2026.xlsx"
    _write_workbook(path)
    import_file(db, path, account_name="현대도크")

    dock = db.scalar(
        select(KeywordStatDaily).where(KeywordStatDaily.keyword_text == "이동식도크임대")
    )
    assert dock.product_category == "물류/도크"
    campaign = db.get(Campaign, dock.campaign_id)
    assert campaign.label_category is None  # 캠페인 라벨을 신뢰하지 않는다


def test_import_records_file_hash_and_period(db: Session, tmp_path: Path) -> None:
    path = tmp_path / "타임렌탈_2026.xlsx"
    _write_workbook(path)
    result = import_file(db, path, account_name="타임렌탈")

    record = db.scalar(select(HistoricalImport))
    assert record.file_sha256 == result.file_sha256
    assert record.period_start == date(2026, 3, 1)
    assert record.period_end == date(2026, 3, 2)
    assert record.trust_status == TrustStatus.UNVERIFIED
    assert "keyword" in record.summary["mapped_columns"]


def test_import_is_idempotent(db: Session, tmp_path: Path) -> None:
    path = tmp_path / "OMBC_2026.xlsx"
    _write_workbook(path)
    import_file(db, path, account_name="OMBC")
    import_file(db, path, account_name="OMBC")

    assert len(db.scalars(select(KeywordStatDaily)).all()) == 3
    assert len(db.scalars(select(Keyword)).all()) == 3


def test_import_directory_creates_unknown_accounts(db: Session, tmp_path: Path) -> None:
    """계정은 DB 기반 동적 관리 — 새 계정 파일이 들어오면 계정을 만든다 (§2)."""
    _write_workbook(tmp_path / "신규계정_2026.xlsx")
    results = import_directory(db, tmp_path)
    assert len(results) == 1
    assert db.scalar(select(Account).where(Account.name == "신규계정")) is not None
