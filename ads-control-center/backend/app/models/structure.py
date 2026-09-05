"""Account / campaign / adgroup / keyword structure tables."""
from __future__ import annotations

from datetime import date

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import DataSource, ProductCategory, TrustStatus
from app.db.base import Base, TimestampMixin


class Account(Base, TimestampMixin):
    """관리 대상 계정 (spec §2). 계정은 DB 기반으로 동적 추가된다."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    team: Mapped[str | None] = mapped_column(String(64))
    naver_customer_id: Mapped[str | None] = mapped_column(String(32), unique=True)

    # 매출 성장계정(다다그룹/타임렌탈)은 광고비 증가만으로 비효율로 판정하지 않는다 (§3).
    is_growth_account: Mapped[bool] = mapped_column(Boolean, default=False)
    # 성장이 둔한 계정은 광고효율 개선 우선대상 (§5).
    efficiency_priority: Mapped[bool] = mapped_column(Boolean, default=False)
    # 현대도크처럼 취급 상품이 제한된 계정 (§6).
    allowed_categories: Mapped[list | None] = mapped_column(JSON)
    contribution_margin_rate: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)

    campaigns: Mapped[list[Campaign]] = relationship(back_populates="account")


class Campaign(Base, TimestampMixin):
    """캠페인.

    주의: 캠페인명은 상품분류의 Source of Truth 가 아니다 (§9 캠페인 라벨 오류).
    ``label_category`` 는 어디까지나 '엑셀/계정이 주장하는 라벨' 이며,
    실제 상품군은 keyword_classification 이 결정한다.
    """

    __tablename__ = "campaigns"
    __table_args__ = (UniqueConstraint("account_id", "name", name="uq_campaigns_account_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    campaign_type: Mapped[str | None] = mapped_column(String(64))
    label_category: Mapped[str | None] = mapped_column(String(32))  # 참고용 라벨일 뿐
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    account: Mapped[Account] = relationship(back_populates="campaigns")


class AdGroup(Base, TimestampMixin):
    __tablename__ = "adgroups"
    __table_args__ = (UniqueConstraint("campaign_id", "name", name="uq_adgroups_campaign_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Keyword(Base, TimestampMixin):
    __tablename__ = "keywords"
    __table_args__ = (
        UniqueConstraint("account_id", "adgroup_id", "text", name="uq_keywords_scope_text"),
        Index("ix_keywords_text", "text"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id"))
    adgroup_id: Mapped[int | None] = mapped_column(ForeignKey("adgroups.id"))
    external_id: Mapped[str | None] = mapped_column(String(64))  # keyword_id (§32)
    text: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_text: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # 대표(메인)키워드 여부 — 자동 OFF 대상이 아니다 (§13).
    is_main_keyword: Mapped[bool] = mapped_column(Boolean, default=False)
    family_root: Mapped[str | None] = mapped_column(String(255), index=True)  # §14
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    first_seen_on: Mapped[date | None] = mapped_column(Date)
    last_seen_on: Mapped[date | None] = mapped_column(Date)


class ProductCategoryRow(Base, TimestampMixin):
    """상품군 마스터 (§10) — 기본값은 seed 로 적재되며 사용자가 추가할 수 있다."""

    __tablename__ = "product_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_seasonal: Mapped[bool] = mapped_column(Boolean, default=False)
    peak_months: Mapped[list | None] = mapped_column(JSON)
    contribution_margin_rate: Mapped[float | None] = mapped_column(Float)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)


class KeywordClassification(Base, TimestampMixin):
    """키워드 문자열 기반 상품군 분류 결과 (§10).

    캠페인명이 아니라 **키워드 문자열** 이 분류의 근거다.
    AI 분류 결과에는 반드시 Confidence Score 를 남긴다.
    """

    __tablename__ = "keyword_classification"
    __table_args__ = (
        UniqueConstraint("normalized_text", name="uq_keyword_classification_text"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    normalized_text: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    raw_text: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default=ProductCategory.UNCLASSIFIED)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)  # 0~100
    matched_rule: Mapped[str | None] = mapped_column(String(255))
    # 고의도 구조 (§15): 지역/행사/용도 + 상품 + 렌탈|대여|임대
    intent_signals: Mapped[dict | None] = mapped_column(JSON)
    region: Mapped[str | None] = mapped_column(String(64), index=True)
    venue: Mapped[str | None] = mapped_column(String(64))
    needs_human_review: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[str | None] = mapped_column(String(64))


class SearchTerm(Base, TimestampMixin):
    """실제 검색어 (§32 search_term)."""

    __tablename__ = "search_terms"
    __table_args__ = (
        Index("ix_search_terms_lookup", "account_id", "stat_date", "normalized_text"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    keyword_id: Mapped[int | None] = mapped_column(ForeignKey("keywords.id"))
    stat_date: Mapped[date] = mapped_column(Date, nullable=False)
    text: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_text: Mapped[str] = mapped_column(String(255), nullable=False)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    is_registered_keyword: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(32), default=DataSource.EXCEL_KAYO)
    trust_status: Mapped[str] = mapped_column(String(16), default=TrustStatus.UNVERIFIED)


class Creative(Base, TimestampMixin):
    """광고 소재 (§23)."""

    __tablename__ = "creatives"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    adgroup_id: Mapped[int | None] = mapped_column(ForeignKey("adgroups.id"))
    external_id: Mapped[str | None] = mapped_column(String(64))
    headline: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    display_url: Mapped[str | None] = mapped_column(String(512))
    landing_url: Mapped[str | None] = mapped_column(String(1024))
    extensions: Mapped[dict | None] = mapped_column(JSON)
    image_url: Mapped[str | None] = mapped_column(String(1024))
    creative_score: Mapped[float | None] = mapped_column(Float)
    score_detail: Mapped[dict | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class LandingPage(Base, TimestampMixin):
    """랜딩페이지 분석 결과 (§24). 블로그도 정상 랜딩으로 인정한다."""

    __tablename__ = "landing_pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    page_type: Mapped[str | None] = mapped_column(String(32))  # SITE / BLOG / SMARTSTORE ...
    http_status: Mapped[int | None] = mapped_column(Integer)
    load_ms: Mapped[int | None] = mapped_column(Integer)
    checks: Mapped[dict | None] = mapped_column(JSON)
    score: Mapped[float | None] = mapped_column(Float)
    last_checked_at: Mapped[str | None] = mapped_column(String(32))
