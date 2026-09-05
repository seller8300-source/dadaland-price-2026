"""DADA NAVER ADS AI CONTROL CENTER — FastAPI 진입점.

운영 철학 (§40): 이 시스템은 '광고비를 적게 쓰게 하는 AI' 가 아니다.
돈이 되는 광고에는 더 쓰고, 돈이 되지 않는 광고는 줄이고,
아직 발견하지 못한 수요를 먼저 찾아내는 것이 목표다.
모든 추천에는 데이터 근거를 표시하고, 근거가 부족하면 DATA INSUFFICIENT 라고 명시한다.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401  — 모든 테이블을 메타데이터에 등록한다
from app.api.routes import analysis, core, data, naver, recommendations, reports, tracking
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    """개발 편의를 위한 테이블 생성. 운영에서는 마이그레이션으로 관리한다."""
    if settings.environment in {"local", "test"}:
        Base.metadata.create_all(engine)
    if settings.enable_scheduler:
        from app.scheduler.jobs import start_scheduler

        start_scheduler()
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    version="0.1.0",
    description=(
        "네이버 검색광고 계정을 회사 전체 관점에서 통합 관리하는 AI 광고총괄 시스템. "
        "NAVER API 는 READ ONLY 이며, 광고 변경은 CEO 승인 후 대행사가 집행한다."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    core.router,
    data.router,
    analysis.router,
    reports.router,
    tracking.router,
    naver.router,
    recommendations.router,
):
    app.include_router(router, prefix=settings.api_prefix)

_tracking_dir = Path(__file__).resolve().parent.parent / "tracking"
if _tracking_dir.exists():
    app.mount("/static", StaticFiles(directory=_tracking_dir), name="static")


@app.get("/")
def root() -> dict:
    return {
        "app": settings.app_name,
        "docs": "/docs",
        "api": settings.api_prefix,
        "steps": {
            "STEP 0": "전환추적 (/track/*)",
            "STEP 1": "Excel Import (/imports)",
            "STEP 2": "Data Quality Validator (/quality/validate)",
            "STEP 3": "2025/2026 Benchmark (/benchmark/yoy)",
            "STEP 4": "NAVER API 연결 (/naver/*)",
            "STEP 5": "Keyword Competition (/competition)",
            "STEP 6": "Daily Report (/reports/daily)",
        },
    }
