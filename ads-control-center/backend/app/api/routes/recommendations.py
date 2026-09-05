"""추천 등록 / CEO 승인 / 효과 측정 (§29–30)."""
from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.enums import RecommendationStatus
from app.models import Account, Recommendation
from app.schemas.common import RecommendationIn
from app.services.recommendation import tracking as recommendation_tracking

router = APIRouter()


@router.post("/recommendations", status_code=201)
def create(payload: RecommendationIn, db: Session = Depends(get_db)) -> dict:
    account = (
        db.scalar(select(Account).where(Account.name == payload.account_name))
        if payload.account_name
        else None
    )
    recommendation = Recommendation(
        account_id=account.id if account else None,
        as_of_date=payload.as_of_date,
        action_type=payload.action_type,
        product_category=payload.product_category,
        keyword_text=payload.keyword_text,
        title=payload.title,
        detail=payload.detail,
        expected_effect=payload.expected_effect,
        confidence=payload.confidence,
        evidence=payload.evidence,
    )
    db.add(recommendation)
    db.commit()
    recommendation_tracking.capture_baseline(db, recommendation)
    return {"id": recommendation.id, "baseline": recommendation.baseline_snapshot}


@router.get("/recommendations")
def list_recommendations(status: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(Recommendation).order_by(Recommendation.as_of_date.desc())
    if status:
        query = query.where(Recommendation.status == status)
    return [
        {
            "id": r.id,
            "account_id": r.account_id,
            "as_of": r.as_of_date.isoformat(),
            "action_type": r.action_type,
            "title": r.title,
            "detail": r.detail,
            "confidence": r.confidence,
            "status": r.status,
            "evidence": r.evidence,
            "baseline": r.baseline_snapshot,
        }
        for r in db.scalars(query)
    ]


@router.post("/recommendations/{recommendation_id}/approve")
def approve(recommendation_id: int, approved_by: str, db: Session = Depends(get_db)) -> dict:
    """CEO 승인. 승인해도 시스템이 광고를 바꾸지 않는다 — 케이오마케팅이 집행한다."""
    recommendation = db.get(Recommendation, recommendation_id)
    if recommendation is None:
        raise HTTPException(status_code=404, detail="추천을 찾을 수 없습니다.")
    recommendation.status = RecommendationStatus.APPROVED
    recommendation.approved_by = approved_by
    recommendation.approved_at = datetime.now(UTC)
    db.commit()
    return {"id": recommendation.id, "status": recommendation.status}


@router.post("/recommendations/{recommendation_id}/evaluate")
def evaluate(
    recommendation_id: int,
    measured_on: date | None = None,
    window_days: int = 14,
    db: Session = Depends(get_db),
) -> dict:
    recommendation = db.get(Recommendation, recommendation_id)
    if recommendation is None:
        raise HTTPException(status_code=404, detail="추천을 찾을 수 없습니다.")
    result = recommendation_tracking.evaluate(
        db, recommendation, measured_on or date.today(), window_days
    )
    return {
        "recommendation_id": recommendation.id,
        "outcome": result.outcome,
        "before": result.before_snapshot,
        "after": result.after_snapshot,
        "delta": result.delta,
        "note": result.note,
    }


@router.get("/recommendations/effectiveness")
def effectiveness(since: date, db: Session = Depends(get_db)) -> dict:
    return recommendation_tracking.effectiveness(db, since)
