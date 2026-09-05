"""STEP 0 — 전환추적 (§7).

목표 체인:
    KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE

렌탈은 전화문의 비중이 크므로 웹 전환만으로 부족하다.
전화 버튼 클릭(웹) 과 실제 통화(통화추적/상담기록) 를 같은 원장에 적재하고,
lead_id 로 견적·계약·매출까지 이어 붙인다.

귀속(attribution) 은 추측하지 않는다. 근거가 없으면 attribution_confidence 를
낮게 남기고 method 에 사유를 기록한다 (§40).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from urllib.parse import parse_qs, urlparse

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import ConversionType
from app.models import Account, Conversion, Keyword
from app.services.classification.dictionary import normalize

# 네이버 검색광고가 랜딩 URL 에 붙이는 파라미터
NAVER_PARAMS = ("n_keyword", "n_query", "n_ad_group", "n_campaign_type", "n_rank", "n_media", "n_ad")
UTM_PARAMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")

FUNNEL_ORDER = [
    ConversionType.PHONE_CLICK,
    ConversionType.KAKAO_INQUIRY,
    ConversionType.CONSULT_REQUEST,
    ConversionType.QUOTE_REQUEST,
    ConversionType.CALL_CONNECTED,
    ConversionType.CONTRACT,
    ConversionType.REVENUE,
]


@dataclass(slots=True)
class TrackedEvent:
    conversion_type: str
    occurred_at: datetime | None = None
    account_name: str | None = None
    landing_url: str | None = None
    referrer: str | None = None
    visitor_id: str | None = None
    session_id: str | None = None
    lead_id: str | None = None
    keyword_text: str | None = None
    search_term: str | None = None
    campaign_name: str | None = None
    device: str | None = None
    phone_number_masked: str | None = None
    call_seconds: int | None = None
    value: float = 0.0
    payload: dict | None = None


def parse_tracking_params(url: str | None) -> dict:
    """랜딩 URL 에서 네이버/UTM 파라미터를 뽑는다."""
    if not url:
        return {}
    query = parse_qs(urlparse(url).query)
    extracted = {}
    for key in NAVER_PARAMS + UTM_PARAMS:
        if key in query and query[key]:
            extracted[key] = query[key][0]
    return extracted


def _resolve_keyword(db: Session, account_id: int | None, keyword_text: str | None) -> Keyword | None:
    if not keyword_text:
        return None
    norm = normalize(keyword_text)
    conditions = [Keyword.normalized_text == norm]
    if account_id is not None:
        conditions.append(Keyword.account_id == account_id)
    return db.scalar(select(Keyword).where(and_(*conditions)).limit(1))


def _previous_touch(db: Session, visitor_id: str | None, lead_id: str | None) -> Conversion | None:
    """같은 방문자/리드의 직전 이벤트에서 키워드를 상속한다."""
    if not visitor_id and not lead_id:
        return None
    conditions = []
    if lead_id:
        conditions.append(Conversion.lead_id == lead_id)
    if visitor_id:
        conditions.append(Conversion.visitor_id == visitor_id)
    return db.scalar(
        select(Conversion)
        .where(or_(*conditions), Conversion.keyword_text.isnot(None))
        .order_by(Conversion.occurred_at.desc())
        .limit(1)
    )


def record_event(db: Session, event: TrackedEvent) -> Conversion:
    """전환 이벤트 1건을 적재하고 키워드에 귀속한다."""
    if not Conversion.is_valid_type(event.conversion_type):
        raise ValueError(f"알 수 없는 전환유형: {event.conversion_type}")

    occurred_at = event.occurred_at or datetime.now(UTC)
    params = parse_tracking_params(event.landing_url)

    account = None
    if event.account_name:
        account = db.scalar(select(Account).where(Account.name == event.account_name))

    keyword_text = event.keyword_text or params.get("n_keyword") or params.get("utm_term")
    search_term = event.search_term or params.get("n_query")
    campaign_name = event.campaign_name or params.get("utm_campaign")

    method = None
    confidence = 0.0
    if params.get("n_keyword"):
        method, confidence = "NAVER_URL_PARAM", 95.0
    elif params.get("utm_term"):
        method, confidence = "UTM_PARAM", 80.0
    elif event.keyword_text:
        method, confidence = "CLIENT_REPORTED", 70.0

    if not keyword_text:
        previous = _previous_touch(db, event.visitor_id, event.lead_id)
        if previous is not None and previous.keyword_text:
            keyword_text = previous.keyword_text
            search_term = search_term or previous.search_term
            account = account or (
                db.get(Account, previous.account_id) if previous.account_id else None
            )
            method, confidence = "PREVIOUS_TOUCH", 60.0

    if method is None:
        method, confidence = "UNATTRIBUTED", 0.0

    keyword = _resolve_keyword(db, account.id if account else None, keyword_text)
    if keyword and account is None:
        account = db.get(Account, keyword.account_id)

    conversion = Conversion(
        account_id=account.id if account else None,
        keyword_id=keyword.id if keyword else None,
        conversion_type=event.conversion_type,
        occurred_at=occurred_at,
        occurred_on=occurred_at.date(),
        lead_id=event.lead_id,
        visitor_id=event.visitor_id,
        session_id=event.session_id,
        keyword_text=keyword_text,
        search_term=search_term,
        campaign_name=campaign_name,
        landing_url=event.landing_url,
        referrer=event.referrer,
        device=event.device,
        phone_number_masked=event.phone_number_masked,
        call_seconds=event.call_seconds,
        value=float(event.value or 0.0),
        attribution_method=method,
        attribution_confidence=confidence,
        payload={"tracking_params": params, **(event.payload or {})},
    )
    db.add(conversion)
    db.commit()
    return conversion


def funnel(
    db: Session,
    start: date,
    end: date,
    account_id: int | None = None,
    keyword_text: str | None = None,
) -> dict:
    """KEYWORD → CLICK → INQUIRY → QUOTE → CONTRACT → REVENUE 집계."""
    conditions = [Conversion.occurred_on >= start, Conversion.occurred_on <= end]
    if account_id is not None:
        conditions.append(Conversion.account_id == account_id)
    if keyword_text:
        conditions.append(Conversion.keyword_text == keyword_text)

    rows = db.execute(
        select(
            Conversion.conversion_type,
            func.count(Conversion.id),
            func.sum(Conversion.value),
        )
        .where(and_(*conditions))
        .group_by(Conversion.conversion_type)
    ).all()

    counts = {conversion_type: 0 for conversion_type in FUNNEL_ORDER}
    revenue = 0.0
    for conversion_type, count, value in rows:
        counts[conversion_type] = int(count or 0)
        if conversion_type in (ConversionType.REVENUE, ConversionType.CONTRACT):
            revenue += float(value or 0.0)

    inquiries = (
        counts[ConversionType.CONSULT_REQUEST]
        + counts[ConversionType.KAKAO_INQUIRY]
        + counts[ConversionType.CALL_CONNECTED]
    )
    quotes = counts[ConversionType.QUOTE_REQUEST]
    contracts = counts[ConversionType.CONTRACT]

    from app.services.benchmark.metrics import period_metrics

    ad = period_metrics(db, start, end, account_id)
    total_events = sum(counts.values())

    return {
        "period": [start.isoformat(), end.isoformat()],
        "clicks": ad.clicks,
        "cost": round(ad.cost, 1),
        "events": {str(k): v for k, v in counts.items()},
        "inquiries": inquiries,
        "quotes": quotes,
        "contracts": contracts,
        "revenue": round(revenue, 1),
        "click_to_inquiry_pct": round(inquiries / ad.clicks * 100, 2) if ad.clicks else None,
        "inquiry_to_quote_pct": round(quotes / inquiries * 100, 2) if inquiries else None,
        "quote_to_contract_pct": round(contracts / quotes * 100, 2) if quotes else None,
        "cost_per_inquiry": round(ad.cost / inquiries, 1) if inquiries else None,
        "cost_per_contract": round(ad.cost / contracts, 1) if contracts else None,
        "status": "OK" if total_events else "DATA INSUFFICIENT — 전환 이벤트가 아직 수집되지 않았습니다.",
    }


def coverage(db: Session, start: date, end: date) -> dict:
    """전환추적 설치 상태 점검 — 어느 계정이 아직 신호를 보내지 않는가."""
    accounts = list(db.scalars(select(Account).where(Account.is_active.is_(True))))
    rows = db.execute(
        select(Conversion.account_id, func.count(Conversion.id))
        .where(and_(Conversion.occurred_on >= start, Conversion.occurred_on <= end))
        .group_by(Conversion.account_id)
    ).all()
    counts = {account_id: int(count) for account_id, count in rows}
    unattributed = db.scalar(
        select(func.count(Conversion.id)).where(
            and_(
                Conversion.occurred_on >= start,
                Conversion.occurred_on <= end,
                Conversion.attribution_method == "UNATTRIBUTED",
            )
        )
    )
    return {
        "accounts": [
            {
                "account": account.name,
                "events": counts.get(account.id, 0),
                "installed": counts.get(account.id, 0) > 0,
            }
            for account in accounts
        ],
        "installed_accounts": sum(1 for a in accounts if counts.get(a.id, 0) > 0),
        "total_accounts": len(accounts),
        "unattributed_events": int(unattributed or 0),
    }
