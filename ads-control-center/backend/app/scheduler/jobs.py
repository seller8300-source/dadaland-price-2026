"""APScheduler 잡 (초기 단계). 운영에서는 Cron/Worker 로 확장한다 (§33)."""
from __future__ import annotations

import logging
from datetime import date, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.db.session import session_scope

logger = logging.getLogger(__name__)


def sync_naver_job() -> None:
    from app.services.naver.sync import sync_all

    with session_scope() as db:
        results = sync_all(db, days=3)
    logger.info("naver sync 완료: %s", [(r.account, r.stat_rows) for r in results])


def validate_job() -> None:
    from app.services.quality.validator import validate

    with session_scope() as db:
        report = validate(db)
    logger.info("data quality 검증: %s", report.summary())


def daily_report_job() -> None:
    from app.services.reporting.daily import build, render_text

    with session_scope() as db:
        report = build(db, date.today() - timedelta(days=1))
        logger.info("일일 리포트 생성 완료\n%s", render_text(report))


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="Asia/Seoul")
    scheduler.add_job(sync_naver_job, "cron", hour=settings.naver_sync_cron_hour, id="naver_sync")
    scheduler.add_job(validate_job, "cron", hour=settings.naver_sync_cron_hour, minute=30, id="validate")
    scheduler.add_job(daily_report_job, "cron", hour=settings.daily_report_cron_hour, id="daily_report")
    scheduler.start()
    logger.info("scheduler 시작")
    return scheduler
