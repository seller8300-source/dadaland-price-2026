"""API 요청/응답 스키마."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class PeriodQuery(BaseModel):
    start: date
    end: date


class AccountIn(BaseModel):
    name: str
    team: str | None = None
    naver_customer_id: str | None = None
    is_growth_account: bool = False
    efficiency_priority: bool = False
    allowed_categories: list[str] | None = None
    contribution_margin_rate: float | None = None
    note: str | None = None


class AccountOut(AccountIn):
    id: int
    is_active: bool = True

    model_config = {"from_attributes": True}


class ImportRequest(BaseModel):
    path: str = Field(description="서버에서 접근 가능한 파일 또는 디렉터리 경로")
    account_name: str | None = None
    source: str = "EXCEL_KAYO"


class TrackEventIn(BaseModel):
    conversion_type: str
    account_name: str | None = None
    occurred_at: datetime | None = None
    landing_url: str | None = None
    page_url: str | None = None
    referrer: str | None = None
    visitor_id: str | None = None
    session_id: str | None = None
    lead_id: str | None = None
    keyword_text: str | None = None
    search_term: str | None = None
    campaign_name: str | None = None
    device: str | None = None
    value: float = 0.0
    payload: dict | None = None


class CallEventIn(BaseModel):
    """통화추적/상담기록 연동용 (§7 — 렌탈은 전화문의 비중이 크다)."""

    occurred_at: datetime | None = None
    account_name: str | None = None
    lead_id: str | None = None
    visitor_id: str | None = None
    phone_number_masked: str | None = None
    call_seconds: int | None = None
    keyword_text: str | None = None
    value: float = 0.0
    payload: dict | None = None


class SalesIn(BaseModel):
    account_name: str
    sale_date: date
    revenue: float
    contribution_profit: float | None = None
    contract_count: int = 0
    product_category: str | None = None


class RecommendationIn(BaseModel):
    account_name: str | None = None
    as_of_date: date
    action_type: str
    title: str
    detail: str
    keyword_text: str | None = None
    product_category: str | None = None
    expected_effect: str | None = None
    confidence: float = 0.0
    evidence: list[dict] | None = None


class ApprovalIn(BaseModel):
    approved_by: str
    selected: list[int] = Field(default_factory=list, description="'1, 3, 5번 진행' 의 번호들")


class EventIn(BaseModel):
    name: str
    venue: str | None = None
    region: str | None = None
    event_type: str | None = None
    start_date: date
    end_date: date | None = None
    expected_products: list[str] | None = None
    suggested_keywords: list[str] | None = None
    setup_lead_days: int = 21
    source_url: str | None = None
