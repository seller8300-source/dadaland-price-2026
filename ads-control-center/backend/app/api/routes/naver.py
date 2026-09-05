"""STEP 4 — NAVER Search Ad API 라우트 (READ ONLY)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.services.naver import sync as naver_sync

router = APIRouter()


@router.get("/naver/status")
def status() -> dict:
    return {
        "read_only": settings.naver_read_only,
        "configured_customers": settings.naver_customers,
        "credentials_present": bool(settings.naver_api_key and settings.naver_secret_key),
        "policy": "AI 는 입찰가/광고를 자동 변경하지 않는다. DATA → AI 분석 → CEO 승인 → 케이오 실행 (§30).",
        **naver_sync.retention_metadata(),
    }


@router.post("/naver/sync")
def sync(days: int = 7, db: Session = Depends(get_db)) -> list[dict]:
    results = naver_sync.sync_all(db, days=days)
    return [
        {
            "account": r.account,
            "campaigns": r.campaigns,
            "adgroups": r.adgroups,
            "keywords": r.keywords,
            "creatives": r.creatives,
            "stat_rows": r.stat_rows,
            "errors": r.errors,
        }
        for r in results
    ]
