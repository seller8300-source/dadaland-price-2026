"""Daily performance, sales, conversions."""
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

from app.core.enums import ConversionType, DataSource, TrustStatus
from app.db.base import Base, TimestampMixin


class KeywordStatDaily(Base, TimestampMixin):
    """일자 x 키워드 성과. 시스템의 사실상 fact table."""

    __tablename__ = "keyword_stats_daily"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "stat_date", "keyword_id", "device", "source",
            name="uq_keyword_stats_daily_grain",
        ),
        Index("ix_keyword_stats_daily_account_date", "account_id", "stat_date"),
        Index("ix_keyword_stats_daily_category_date", "product_category", "stat_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id"))
    adgroup_id: Mapped[int | None] = mapped_column(ForeignKey("adgroups.id"))
    keyword_id: Mapped[int | None] = mapped_column(ForeignKey("keywords.id"))
    stat_date: Mapped[date] = mapped_column(Date, nullable=False)

    keyword_text: Mapped[str | None] = mapped_column(String(255))
    device: Mapped[str] = mapped_column(String(16), default="ALL")  # PC / MOBILE / ALL

    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    average_rank: Mapped[float | None] = mapped_column(Float)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    conversion_value: Mapped[float] = mapped_column(Float, default=0.0)

    # 상품군은 키워드 문자열 분류 결과를 복제해 둔다 (집계 성능 목적).
    product_category: Mapped[str | None] = mapped_column(String(32))
    classification_confidence: Mapped[float | None] = mapped_column(Float)

    source: Mapped[str] = mapped_column(String(32), default=DataSource.EXCEL_KAYO)
    trust_status: Mapped[str] = mapped_column(String(16), default=TrustStatus.UNVERIFIED)
    import_id: Mapped[int | None] = mapped_column(ForeignKey("historical_imports.id"))
    raw_row: Mapped[dict | None] = mapped_column(JSON)

    @property
    def ctr(self) -> float | None:
        return (self.clicks / self.impressions * 100) if self.impressions else None

    @property
    def cpc(self) -> float | None:
        return (self.cost / self.clicks) if self.clicks else None


class Conversion(Base, TimestampMixin):
    """STEP 0 전환추적 이벤트 (§7).

    KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE 를 잇기 위한 원장.
    렌탈은 전화문의 비중이 크므로 통화 이벤트도 같은 테이블에 적재한다.
    """

    __tablename__ = "conversions"
    __table_args__ = (
        Index("ix_conversions_account_date", "account_id", "occurred_on"),
        Index("ix_conversions_lead", "lead_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    keyword_id: Mapped[int | None] = mapped_column(ForeignKey("keywords.id"))
    conversion_type: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)

    # 귀속 정보 (naver n_media/n_keyword/n_rank, utm_*, click id, 통화번호 등)
    lead_id: Mapped[str | None] = mapped_column(String(64), index=True)
    visitor_id: Mapped[str | None] = mapped_column(String(64), index=True)
    session_id: Mapped[str | None] = mapped_column(String(64))
    keyword_text: Mapped[str | None] = mapped_column(String(255))
    search_term: Mapped[str | None] = mapped_column(String(255))
    campaign_name: Mapped[str | None] = mapped_column(String(255))
    landing_url: Mapped[str | None] = mapped_column(String(1024))
    referrer: Mapped[str | None] = mapped_column(String(1024))
    device: Mapped[str | None] = mapped_column(String(16))
    phone_number_masked: Mapped[str | None] = mapped_column(String(32))
    call_seconds: Mapped[int | None] = mapped_column(Integer)
    value: Mapped[float] = mapped_column(Float, default=0.0)
    attribution_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    attribution_method: Mapped[str | None] = mapped_column(String(32))
    payload: Mapped[dict | None] = mapped_column(JSON)

    @staticmethod
    def is_valid_type(value: str) -> bool:
        return value in set(ConversionType)


class SalesDaily(Base, TimestampMixin):
    """일 매출 (§25). 계약/매출은 외부 시스템에서 연동한다."""

    __tablename__ = "sales_daily"
    __table_args__ = (
        UniqueConstraint("account_id", "sale_date", "product_category", name="uq_sales_daily_grain"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    sale_date: Mapped[date] = mapped_column(Date, nullable=False)
    product_category: Mapped[str | None] = mapped_column(String(32))
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    contribution_profit: Mapped[float | None] = mapped_column(Float)
    contract_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(32), default=DataSource.MANUAL)
    trust_status: Mapped[str] = mapped_column(String(16), default=TrustStatus.UNVERIFIED)


class SalesMonthly(Base, TimestampMixin):
    __tablename__ = "sales_monthly"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "year", "month", "product_category", name="uq_sales_monthly_grain"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    product_category: Mapped[str | None] = mapped_column(String(32))
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    contribution_profit: Mapped[float | None] = mapped_column(Float)
    contribution_margin_rate: Mapped[float | None] = mapped_column(Float)
    contract_count: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text)


class HistoricalImport(Base, TimestampMixin):
    """Excel/RAW import 이력 (§8, §31)."""

    __tablename__ = "historical_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    account_name_raw: Mapped[str | None] = mapped_column(String(64))
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    sheet_name: Mapped[str | None] = mapped_column(String(128))
    source: Mapped[str] = mapped_column(String(32), default=DataSource.EXCEL_KAYO)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    imported_row_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_row_count: Mapped[int] = mapped_column(Integer, default=0)
    trust_status: Mapped[str] = mapped_column(String(16), default=TrustStatus.UNVERIFIED)
    retention_note: Mapped[str | None] = mapped_column(Text)  # API 보존기간 메타 (§31)
    summary: Mapped[dict | None] = mapped_column(JSON)


class DataQualityWarning(Base, TimestampMixin):
    """Data Quality Validator 결과 (§2 STEP, §9)."""

    __tablename__ = "data_quality_warnings"
    __table_args__ = (Index("ix_dq_scope", "scope", "account_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int | None] = mapped_column(ForeignKey("historical_imports.id"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    scope: Mapped[str] = mapped_column(String(64), nullable=False)  # sheet / table / column
    rule_code: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)  # WARNING / REJECTED
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[dict | None] = mapped_column(JSON)
    blocks_analysis: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
