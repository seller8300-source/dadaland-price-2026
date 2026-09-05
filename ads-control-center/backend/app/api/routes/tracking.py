"""STEP 0 — 전환추적 수집 라우트 (§7)."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.enums import ConversionType
from app.models import Account, SalesDaily
from app.schemas.common import CallEventIn, SalesIn, TrackEventIn
from app.services.conversion import tracking as tracking_service

router = APIRouter()


@router.post("/track/event", status_code=202)
async def track_event(request: Request, db: Session = Depends(get_db)) -> dict:
    """웹 스니펫(dada-track.js)이 보내는 전환 이벤트를 받는다.

    sendBeacon 은 Content-Type 이 다를 수 있으므로 본문을 직접 파싱한다.
    """
    try:
        raw = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        import json

        try:
            raw = json.loads(body)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"잘못된 본문: {error}") from error

    payload = TrackEventIn(**raw)
    if payload.conversion_type not in set(ConversionType):
        raise HTTPException(status_code=400, detail=f"알 수 없는 전환유형: {payload.conversion_type}")

    event = tracking_service.TrackedEvent(
        conversion_type=payload.conversion_type,
        occurred_at=payload.occurred_at,
        account_name=payload.account_name,
        landing_url=payload.landing_url or payload.page_url,
        referrer=payload.referrer,
        visitor_id=payload.visitor_id,
        session_id=payload.session_id,
        lead_id=payload.lead_id,
        keyword_text=payload.keyword_text,
        search_term=payload.search_term,
        campaign_name=payload.campaign_name,
        device=payload.device,
        value=payload.value,
        payload=payload.payload,
    )
    conversion = tracking_service.record_event(db, event)
    return {
        "id": conversion.id,
        "attribution_method": conversion.attribution_method,
        "attribution_confidence": conversion.attribution_confidence,
    }


@router.post("/track/call", status_code=202)
def track_call(payload: CallEventIn, db: Session = Depends(get_db)) -> dict:
    """통화추적/상담기록 연동 — 실제 통화를 전환으로 적재한다."""
    event = tracking_service.TrackedEvent(
        conversion_type=ConversionType.CALL_CONNECTED,
        occurred_at=payload.occurred_at or datetime.now(UTC),
        account_name=payload.account_name,
        visitor_id=payload.visitor_id,
        lead_id=payload.lead_id,
        keyword_text=payload.keyword_text,
        phone_number_masked=payload.phone_number_masked,
        call_seconds=payload.call_seconds,
        value=payload.value,
        payload=payload.payload,
    )
    conversion = tracking_service.record_event(db, event)
    return {"id": conversion.id, "attribution_method": conversion.attribution_method}


@router.get("/track/funnel")
def funnel(
    start: date | None = None,
    end: date | None = None,
    account: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE."""
    end = end or date.today()
    start = start or (end - timedelta(days=29))
    account_id = None
    if account:
        row = db.scalar(select(Account).where(Account.name == account))
        account_id = row.id if row else None
    return tracking_service.funnel(db, start, end, account_id)


@router.get("/track/coverage")
def coverage(start: date | None = None, end: date | None = None, db: Session = Depends(get_db)) -> dict:
    """전환추적 설치 현황 — STEP 0 진행상황 확인용."""
    end = end or date.today()
    start = start or (end - timedelta(days=29))
    return tracking_service.coverage(db, start, end)


@router.post("/sales", status_code=201)
def upsert_sales(payload: SalesIn, db: Session = Depends(get_db)) -> dict:
    """매출 연동 (§25). 계약/매출은 외부 시스템에서 넣는다."""
    account = db.scalar(select(Account).where(Account.name == payload.account_name))
    if account is None:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")
    existing = db.scalar(
        select(SalesDaily).where(
            SalesDaily.account_id == account.id,
            SalesDaily.sale_date == payload.sale_date,
            SalesDaily.product_category.is_(None)
            if payload.product_category is None
            else SalesDaily.product_category == payload.product_category,
        )
    )
    row = existing or SalesDaily(
        account_id=account.id, sale_date=payload.sale_date, product_category=payload.product_category
    )
    row.revenue = payload.revenue
    row.contribution_profit = payload.contribution_profit
    row.contract_count = payload.contract_count
    if existing is None:
        db.add(row)
    db.commit()
    return {"id": row.id, "account": account.name, "revenue": row.revenue}
