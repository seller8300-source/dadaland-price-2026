"""STEP 1 — 케이오 Excel / RAW export 적재기.

원칙 (§8 Historical Data Trust Policy):
  * 적재된 모든 행은 최초 UNVERIFIED 다.
  * 검증(STEP 2)을 통과한 데이터만 TRUSTED 로 승격된다.
  * Excel 에 있다는 이유만으로 분석에 사용하지 않는다.
  * 원본 행은 raw_row 에 그대로 보존한다 (재검증/재분류를 위해).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import DataSource, TrustStatus
from app.models import (
    Account,
    AdGroup,
    Campaign,
    HistoricalImport,
    Keyword,
    KeywordClassification,
    KeywordStatDaily,
    SearchTerm,
)
from app.services.classification.classifier import (
    classify_keyword,
    keyword_family_root,
)
from app.services.classification.dictionary import normalize
from app.services.importer.column_map import map_headers, to_date, to_int, to_number

MAIN_KEYWORDS_DEFAULT = {"코끼리에어컨", "이동식에어컨", "업소용냉장고", "산업용제습기"}
_MAIN_KEYWORDS_NORM = {normalize(k) for k in MAIN_KEYWORDS_DEFAULT}


@dataclass(slots=True)
class SheetResult:
    sheet_name: str
    rows_read: int = 0
    rows_imported: int = 0
    rows_skipped: int = 0
    import_id: int | None = None
    notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ImportResult:
    file_name: str
    file_sha256: str
    account_name: str | None
    sheets: list[SheetResult] = field(default_factory=list)

    @property
    def rows_imported(self) -> int:
        return sum(s.rows_imported for s in self.sheets)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def row_fingerprint(values: list[object]) -> str:
    """행 지문 — 계정 간 데이터 복사 탐지(§9)에 쓰인다."""
    joined = "|".join("" if v is None else str(v).strip() for v in values)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def _load_sheets(path: Path) -> dict[str, list[list[object]]]:
    """xlsx/csv 를 {sheet: rows} 로 읽는다. openpyxl 은 read_only 모드를 쓴다."""
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        import csv

        delimiter = "\t" if suffix == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = [list(r) for r in csv.reader(handle, delimiter=delimiter)]
        return {path.stem: rows}

    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheets: dict[str, list[list[object]]] = {}
    for worksheet in workbook.worksheets:
        sheets[worksheet.title] = [list(row) for row in worksheet.iter_rows(values_only=True)]
    workbook.close()
    return sheets


def _find_header_row(rows: list[list[object]], max_scan: int = 15) -> tuple[int, dict[int, str]]:
    """헤더 위치를 자동 탐지한다. 케이오 시트는 상단에 제목/기간 행이 붙어 있다."""
    best: tuple[int, dict[int, str]] = (-1, {})
    for index, row in enumerate(rows[:max_scan]):
        mapping = map_headers(row)
        if len(mapping) > len(best[1]):
            best = (index, mapping)
    return best


def _get_or_create_account(db: Session, name: str) -> Account:
    account = db.scalar(select(Account).where(Account.name == name))
    if account is None:
        account = Account(name=name, team=name, efficiency_priority=True)
        db.add(account)
        db.flush()
    return account


def _get_or_create_campaign(db: Session, account: Account, name: str | None) -> Campaign | None:
    if not name:
        return None
    campaign = db.scalar(
        select(Campaign).where(Campaign.account_id == account.id, Campaign.name == name)
    )
    if campaign is None:
        # 캠페인명은 라벨일 뿐, 상품분류의 근거가 아니다 (§9).
        campaign = Campaign(account_id=account.id, name=name, label_category=None)
        db.add(campaign)
        db.flush()
    return campaign


def _get_or_create_adgroup(
    db: Session, account: Account, campaign: Campaign | None, name: str | None
) -> AdGroup | None:
    if not name or campaign is None:
        return None
    adgroup = db.scalar(
        select(AdGroup).where(AdGroup.campaign_id == campaign.id, AdGroup.name == name)
    )
    if adgroup is None:
        adgroup = AdGroup(account_id=account.id, campaign_id=campaign.id, name=name)
        db.add(adgroup)
        db.flush()
    return adgroup


def ensure_classification(db: Session, keyword_text: str) -> KeywordClassification:
    """키워드 문자열 분류를 캐시한다 (§10)."""
    norm = normalize(keyword_text)
    row = db.scalar(
        select(KeywordClassification).where(KeywordClassification.normalized_text == norm)
    )
    if row is not None:
        return row
    result = classify_keyword(keyword_text)
    row = KeywordClassification(
        normalized_text=result.normalized_text or norm,
        raw_text=keyword_text,
        category=result.category,
        method=result.method,
        confidence=result.confidence,
        matched_rule=result.matched_rule,
        intent_signals=result.intent_signals,
        region=result.region,
        venue=result.venue,
        needs_human_review=result.needs_human_review,
    )
    db.add(row)
    db.flush()
    return row


def _get_or_create_keyword(
    db: Session,
    account: Account,
    campaign: Campaign | None,
    adgroup: AdGroup | None,
    text: str,
    external_id: str | None,
    stat_date: date | None,
) -> Keyword:
    adgroup_id = adgroup.id if adgroup else None
    adgroup_condition = (
        Keyword.adgroup_id.is_(None) if adgroup_id is None else Keyword.adgroup_id == adgroup_id
    )
    keyword = db.scalar(
        select(Keyword).where(
            Keyword.account_id == account.id,
            adgroup_condition,
            Keyword.text == text,
        )
    )
    if keyword is None:
        keyword = Keyword(
            account_id=account.id,
            campaign_id=campaign.id if campaign else None,
            adgroup_id=adgroup_id,
            text=text,
            normalized_text=normalize(text),
            external_id=external_id,
            is_main_keyword=normalize(text) in _MAIN_KEYWORDS_NORM,
            family_root=keyword_family_root(text),
            first_seen_on=stat_date,
            last_seen_on=stat_date,
        )
        db.add(keyword)
        db.flush()
    elif stat_date:
        if keyword.first_seen_on is None or stat_date < keyword.first_seen_on:
            keyword.first_seen_on = stat_date
        if keyword.last_seen_on is None or stat_date > keyword.last_seen_on:
            keyword.last_seen_on = stat_date
    return keyword


def import_file(
    db: Session,
    path: str | Path,
    account_name: str | None = None,
    source: str = DataSource.EXCEL_KAYO,
    default_date: date | None = None,
) -> ImportResult:
    """엑셀/CSV 1개 파일을 적재한다.

    ``account_name`` 이 없으면 시트의 '계정' 컬럼, 그것도 없으면 파일명을 쓴다.
    적재 결과는 전부 UNVERIFIED 이며, 검증 전에는 분석에 사용되지 않는다.
    """
    path = Path(path)
    file_hash = sha256_of(path)
    fallback_account = account_name or path.stem.split("_")[0]
    result = ImportResult(file_name=path.name, file_sha256=file_hash, account_name=account_name)

    for sheet_name, rows in _load_sheets(path).items():
        sheet_result = SheetResult(sheet_name=sheet_name, rows_read=max(len(rows) - 1, 0))
        header_index, mapping = _find_header_row(rows)
        if header_index < 0 or "keyword" not in mapping.values() and "search_term" not in mapping.values():
            sheet_result.notes.append(
                "키워드/검색어 컬럼을 찾지 못해 건너뜀 (수동 매핑 필요)"
            )
            sheet_result.rows_skipped = sheet_result.rows_read
            result.sheets.append(sheet_result)
            continue

        header_row = rows[header_index]
        data_rows = rows[header_index + 1 :]
        is_search_term_sheet = "keyword" not in mapping.values()

        record = HistoricalImport(
            file_name=path.name,
            file_sha256=file_hash,
            sheet_name=sheet_name,
            source=source,
            account_name_raw=account_name,
            row_count=len(data_rows),
            trust_status=TrustStatus.UNVERIFIED,
        )
        db.add(record)
        db.flush()
        sheet_result.import_id = record.id

        dates_seen: list[date] = []
        fingerprints: list[str] = []
        imported = 0
        skipped = 0

        for row in data_rows:
            values = {field: row[idx] if idx < len(row) else None for idx, field in mapping.items()}
            keyword_text = str(values.get("keyword") or values.get("search_term") or "").strip()
            if not keyword_text or keyword_text.lower() in {"none", "합계", "총계", "total"}:
                skipped += 1
                continue

            stat_date = to_date(values.get("date")) or default_date
            if stat_date is None:
                skipped += 1
                continue
            dates_seen.append(stat_date)
            fingerprints.append(row_fingerprint([row[i] if i < len(row) else None for i in mapping]))

            row_account_name = str(values.get("account") or "").strip() or fallback_account
            account = _get_or_create_account(db, account_name or row_account_name)
            record.account_id = account.id

            classification = ensure_classification(db, keyword_text)
            impressions = to_int(values.get("impressions"))
            clicks = to_int(values.get("clicks"))
            cost = to_number(values.get("cost"))
            if cost is None:
                cpc = to_number(values.get("cpc"))
                cost = (cpc or 0.0) * clicks
            raw_row = {
                str(header_row[idx]): (row[idx] if idx < len(row) else None) for idx in mapping
            }

            if is_search_term_sheet:
                db.add(
                    SearchTerm(
                        account_id=account.id,
                        stat_date=stat_date,
                        text=keyword_text,
                        normalized_text=normalize(keyword_text),
                        impressions=impressions,
                        clicks=clicks,
                        cost=float(cost or 0.0),
                        conversions=to_int(values.get("conversions")),
                        source=source,
                        trust_status=TrustStatus.UNVERIFIED,
                    )
                )
                imported += 1
                continue

            campaign = _get_or_create_campaign(db, account, str(values.get("campaign") or "").strip() or None)
            adgroup = _get_or_create_adgroup(db, account, campaign, str(values.get("adgroup") or "").strip() or None)
            keyword = _get_or_create_keyword(
                db,
                account,
                campaign,
                adgroup,
                keyword_text,
                str(values.get("keyword_id") or "").strip() or None,
                stat_date,
            )
            device = str(values.get("device") or "ALL").strip().upper() or "ALL"

            existing = db.scalar(
                select(KeywordStatDaily).where(
                    KeywordStatDaily.account_id == account.id,
                    KeywordStatDaily.stat_date == stat_date,
                    KeywordStatDaily.keyword_id == keyword.id,
                    KeywordStatDaily.device == device,
                    KeywordStatDaily.source == source,
                )
            )
            stat = existing or KeywordStatDaily(
                account_id=account.id,
                stat_date=stat_date,
                keyword_id=keyword.id,
                device=device,
                source=source,
            )
            stat.campaign_id = campaign.id if campaign else None
            stat.adgroup_id = adgroup.id if adgroup else None
            stat.keyword_text = keyword_text
            stat.impressions = impressions
            stat.clicks = clicks
            stat.cost = float(cost or 0.0)
            stat.average_rank = to_number(values.get("average_rank"))
            stat.conversions = to_int(values.get("conversions"))
            stat.conversion_value = float(to_number(values.get("conversion_value")) or 0.0)
            stat.product_category = classification.category
            stat.classification_confidence = classification.confidence
            stat.trust_status = TrustStatus.UNVERIFIED
            stat.import_id = record.id
            stat.raw_row = raw_row
            if existing is None:
                db.add(stat)
            imported += 1

        record.imported_row_count = imported
        record.skipped_row_count = skipped
        record.period_start = min(dates_seen) if dates_seen else None
        record.period_end = max(dates_seen) if dates_seen else None
        record.summary = {
            "mapped_columns": sorted(set(mapping.values())),
            "unmapped_column_count": max(len(header_row) - len(mapping), 0),
            "row_fingerprints": fingerprints[:5000],
            "is_search_term_sheet": is_search_term_sheet,
        }
        sheet_result.rows_imported = imported
        sheet_result.rows_skipped = skipped
        result.sheets.append(sheet_result)

    db.commit()
    return result


def import_directory(
    db: Session, directory: str | Path, source: str = DataSource.EXCEL_KAYO
) -> list[ImportResult]:
    """디렉터리의 10개 계정 파일을 한 번에 적재한다 (STEP 1)."""
    directory = Path(directory)
    results: list[ImportResult] = []
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() in {".xlsx", ".xlsm", ".csv", ".tsv"} and not path.name.startswith("~$"):
            results.append(import_file(db, path, source=source))
    return results
