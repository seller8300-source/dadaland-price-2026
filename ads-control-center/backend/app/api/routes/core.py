"""계정 / 헬스 / 시드 라우트."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.db.seed import seed_all
from app.models import Account
from app.schemas.common import AccountIn, AccountOut

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.environment,
        "naver_read_only": settings.naver_read_only,
    }


@router.post("/seed")
def seed(db: Session = Depends(get_db)) -> dict:
    """계정 10개 · 상품군 · 운영규칙 기본값을 적재한다."""
    seed_all(db)
    return {"accounts": [a.name for a in db.scalars(select(Account))]}


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)) -> list[Account]:
    return list(db.scalars(select(Account).order_by(Account.name)))


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db)) -> Account:
    if db.scalar(select(Account).where(Account.name == payload.name)):
        raise HTTPException(status_code=409, detail="이미 존재하는 계정명입니다.")
    account = Account(**payload.model_dump())
    db.add(account)
    db.commit()
    return account


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, payload: AccountIn, db: Session = Depends(get_db)) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, key, value)
    db.commit()
    return account
