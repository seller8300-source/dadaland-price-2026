"""STEP 6 — Daily / Weekly Report 라우트 + 케이오 전달 메시지."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.common import ApprovalIn
from app.services.reporting import daily as daily_report
from app.services.reporting import weekly as weekly_report

router = APIRouter()


@router.get("/reports/daily")
def daily(as_of: date | None = None, db: Session = Depends(get_db)) -> dict:
    return daily_report.build(db, as_of).as_dict()


@router.get("/reports/daily.txt", response_class=Response)
def daily_text(as_of: date | None = None, db: Session = Depends(get_db)) -> Response:
    report = daily_report.build(db, as_of)
    return Response(content=daily_report.render_text(report), media_type="text/plain; charset=utf-8")


@router.post("/reports/daily/agency-message", response_class=Response)
def agency_message(
    payload: ApprovalIn, as_of: date | None = None, db: Session = Depends(get_db)
) -> Response:
    """'1, 3, 5번 진행' → 케이오마케팅 전달 메시지 자동 작성 (§30).

    시스템은 광고를 직접 변경하지 않는다. 실행은 케이오마케팅이 한다.
    """
    report = daily_report.build(db, as_of)
    message = daily_report.agency_message(report, payload.selected)
    return Response(content=message, media_type="text/plain; charset=utf-8")


@router.get("/reports/weekly")
def weekly(week_end: date | None = None, db: Session = Depends(get_db)) -> dict:
    return weekly_report.build(db, week_end).as_dict()
