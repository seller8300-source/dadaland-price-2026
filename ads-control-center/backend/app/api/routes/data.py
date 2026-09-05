"""STEP 1–2 — Import / Data Quality 라우트."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import DataQualityWarning, HistoricalImport
from app.schemas.common import ImportRequest
from app.services.importer.excel_import import import_directory, import_file
from app.services.quality.validator import validate

router = APIRouter()


@router.post("/imports")
def run_import(payload: ImportRequest, db: Session = Depends(get_db)) -> dict:
    """엑셀 파일 또는 디렉터리를 적재한다. 적재 직후 상태는 항상 UNVERIFIED."""
    path = Path(payload.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"경로를 찾을 수 없습니다: {path}")

    if path.is_dir():
        results = import_directory(db, path, source=payload.source)
    else:
        results = [import_file(db, path, account_name=payload.account_name, source=payload.source)]

    return {
        "files": [
            {
                "file": result.file_name,
                "sha256": result.file_sha256,
                "rows_imported": result.rows_imported,
                "sheets": [
                    {
                        "sheet": sheet.sheet_name,
                        "read": sheet.rows_read,
                        "imported": sheet.rows_imported,
                        "skipped": sheet.rows_skipped,
                        "notes": sheet.notes,
                    }
                    for sheet in result.sheets
                ],
            }
            for result in results
        ],
        "trust_status": "UNVERIFIED — STEP 2 검증 후 TRUSTED 로 승격됩니다 (§8).",
    }


@router.get("/imports")
def list_imports(db: Session = Depends(get_db)) -> list[dict]:
    return [
        {
            "id": record.id,
            "file": record.file_name,
            "sheet": record.sheet_name,
            "account_id": record.account_id,
            "rows": record.row_count,
            "imported": record.imported_row_count,
            "period": [
                record.period_start.isoformat() if record.period_start else None,
                record.period_end.isoformat() if record.period_end else None,
            ],
            "trust_status": record.trust_status,
        }
        for record in db.scalars(select(HistoricalImport).order_by(HistoricalImport.id.desc()))
    ]


@router.post("/quality/validate")
def run_validation(promote: bool = True, db: Session = Depends(get_db)) -> dict:
    report = validate(db, promote=promote)
    return {
        "summary": report.summary(),
        "blocking": [
            {"rule": f.rule_code, "scope": f.scope, "message": f.message}
            for f in report.blocking_findings[:50]
        ],
    }


@router.get("/quality/warnings")
def list_warnings(db: Session = Depends(get_db)) -> list[dict]:
    return [
        {
            "id": warning.id,
            "account_id": warning.account_id,
            "rule": warning.rule_code,
            "severity": warning.severity,
            "scope": warning.scope,
            "message": warning.message,
            "blocks_analysis": warning.blocks_analysis,
            "evidence": warning.evidence,
        }
        for warning in db.scalars(
            select(DataQualityWarning).order_by(
                DataQualityWarning.blocks_analysis.desc(), DataQualityWarning.id.desc()
            )
        )
    ]
