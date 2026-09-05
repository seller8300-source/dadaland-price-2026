"""Rules, competition, season, events, opportunities, alerts, recommendations."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import (
    AlertLevel,
    CompetitionPolicy,
    RecommendationOutcome,
    RecommendationStatus,
    SeasonState,
)
from app.db.base import Base, TimestampMixin


class BusinessRule(Base, TimestampMixin):
    """회사 운영규칙 (§6 현대도크 물류 ONLY, §19 이불 Primary 등).

    규칙은 코드가 아니라 DB 에 있다 — 계정/상품군이 늘어나도 코드 변경이 없다.
    """

    __tablename__ = "business_rules"
    __table_args__ = (UniqueConstraint("code", name="uq_business_rules_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # ALLOWED_CATEGORY / PRIMARY_ACCOUNT / COMPETITION_POLICY / MARGIN / THRESHOLD
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    product_category: Mapped[str | None] = mapped_column(String(32))
    params: Mapped[dict | None] = mapped_column(JSON)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CompetitionCluster(Base, TimestampMixin):
    """검색의도 기준 경쟁군 (§18). 단순 동일키워드 비교가 아니다."""

    __tablename__ = "competition_clusters"
    __table_args__ = (UniqueConstraint("cluster_key", name="uq_competition_clusters_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cluster_key: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    product_category: Mapped[str | None] = mapped_column(String(32), index=True)
    intent_type: Mapped[str | None] = mapped_column(String(32))  # MAIN / REGION / EVENT / USE
    region: Mapped[str | None] = mapped_column(String(64))
    member_keywords: Mapped[list | None] = mapped_column(JSON)
    policy: Mapped[str] = mapped_column(String(32), default=CompetitionPolicy.ALLOWED)
    primary_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    max_accounts_off_season: Mapped[int | None] = mapped_column(Integer)
    max_accounts_in_season: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)


class SeasonIndex(Base, TimestampMixin):
    """상품군 x 기간 시즌 지수/상태 (§20)."""

    __tablename__ = "season_indices"
    __table_args__ = (
        UniqueConstraint("product_category", "as_of_date", name="uq_season_indices_grain"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_category: Mapped[str] = mapped_column(String(32), nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    demand_index: Mapped[float] = mapped_column(Float, default=0.0)
    yoy_index: Mapped[float | None] = mapped_column(Float)
    state: Mapped[str] = mapped_column(String(16), default=SeasonState.OFF_SEASON)
    expected_rise_date: Mapped[date | None] = mapped_column(Date)
    recommended_setup_start: Mapped[date | None] = mapped_column(Date)
    recommended_setup_end: Mapped[date | None] = mapped_column(Date)
    evidence: Mapped[dict | None] = mapped_column(JSON)


class Event(Base, TimestampMixin):
    """행사/전시 (§22)."""

    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("name", "start_date", "venue", name="uq_events_identity"),
        Index("ix_events_dates", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    venue: Mapped[str | None] = mapped_column(String(128))
    region: Mapped[str | None] = mapped_column(String(64))
    event_type: Mapped[str | None] = mapped_column(String(32))  # 박람회/전시/페어/축제/콘서트...
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    expected_products: Mapped[list | None] = mapped_column(JSON)
    suggested_keywords: Mapped[list | None] = mapped_column(JSON)
    setup_lead_days: Mapped[int] = mapped_column(Integer, default=21)  # D-14 ~ D-45 (§22)
    source_url: Mapped[str | None] = mapped_column(String(1024))
    note: Mapped[str | None] = mapped_column(Text)


class Opportunity(Base, TimestampMixin):
    """미세팅 키워드 / 지역 / 시즌 / 행사 기회 (§16, §17)."""

    __tablename__ = "opportunities"
    __table_args__ = (Index("ix_opportunities_conf", "confidence"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    keyword_text: Mapped[str] = mapped_column(String(255), nullable=False)
    opportunity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # NEW_KEYWORD / REGION / SEASON / EVENT
    product_category: Mapped[str | None] = mapped_column(String(32))
    suggested_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    region: Mapped[str | None] = mapped_column(String(64))
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"))
    estimated_cpc: Mapped[float | None] = mapped_column(Float)
    estimated_monthly_volume: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)  # 0~100 (§17)
    evidence: Mapped[list | None] = mapped_column(JSON)  # 최소 2개 근거 (§17)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="OPEN")
    generated_on: Mapped[date | None] = mapped_column(Date)


class Alert(Base, TimestampMixin):
    """이상징후 / 정책위반 알림 (§27)."""

    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_account_date", "account_id", "as_of_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(32), nullable=False)
    level: Mapped[str] = mapped_column(String(16), default=AlertLevel.WATCH)
    product_category: Mapped[str | None] = mapped_column(String(32))
    keyword_text: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[dict | None] = mapped_column(JSON)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class Recommendation(Base, TimestampMixin):
    """AI 추천. 실행은 사람이 한다 (§30) — 시스템은 절대 자동 변경하지 않는다."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    action_type: Mapped[str] = mapped_column(String(48), nullable=False)
    # BID_DOWN / BID_UP / ADD_KEYWORD / PAUSE_KEYWORD / CREATIVE_SWAP / LANDING_FIX / POLICY_FIX
    product_category: Mapped[str | None] = mapped_column(String(32))
    keyword_text: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    expected_effect: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    evidence: Mapped[list | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default=RecommendationStatus.PROPOSED)
    approved_by: Mapped[str | None] = mapped_column(String(64))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    agency_message: Mapped[str | None] = mapped_column(Text)  # 케이오마케팅 전달 문구
    baseline_snapshot: Mapped[dict | None] = mapped_column(JSON)  # §29 변경 전


class RecommendationResult(Base, TimestampMixin):
    """추천 전/후 성과 비교 (§29)."""

    __tablename__ = "recommendation_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("recommendations.id"), nullable=False
    )
    measured_on: Mapped[date] = mapped_column(Date, nullable=False)
    window_days: Mapped[int] = mapped_column(Integer, default=14)
    before_snapshot: Mapped[dict | None] = mapped_column(JSON)
    after_snapshot: Mapped[dict | None] = mapped_column(JSON)
    delta: Mapped[dict | None] = mapped_column(JSON)
    outcome: Mapped[str] = mapped_column(String(32), default=RecommendationOutcome.PENDING)
    note: Mapped[str | None] = mapped_column(Text)
