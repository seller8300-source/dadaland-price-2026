"""NAVER API → DB 동기화 (STEP 4).

API 로 가져온 데이터는 Excel 과 달리 원본이므로 기본 신뢰도가 높지만,
그래도 동일한 품질 검증 파이프라인을 통과시킨다 (§8).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import DataSource, TrustStatus
from app.models import Account, AdGroup, Campaign, Creative, Keyword, KeywordStatDaily
from app.services.classification.classifier import keyword_family_root
from app.services.classification.dictionary import normalize
from app.services.importer.excel_import import ensure_classification
from app.services.naver.client import REPORT_RETENTION_DAYS, NaverCredentials, NaverSearchAdClient


@dataclass(slots=True)
class SyncResult:
    account: str
    campaigns: int = 0
    adgroups: int = 0
    keywords: int = 0
    creatives: int = 0
    stat_rows: int = 0
    errors: list[str] = field(default_factory=list)


def sync_structure(db: Session, account: Account, client: NaverSearchAdClient) -> SyncResult:
    """캠페인/광고그룹/키워드/소재 구조를 동기화한다."""
    result = SyncResult(account=account.name)

    for raw_campaign in client.campaigns():
        campaign = db.scalar(
            select(Campaign).where(
                Campaign.account_id == account.id, Campaign.external_id == raw_campaign["nccCampaignId"]
            )
        ) or db.scalar(
            select(Campaign).where(
                Campaign.account_id == account.id, Campaign.name == raw_campaign.get("name", "")
            )
        )
        if campaign is None:
            campaign = Campaign(account_id=account.id, name=raw_campaign.get("name", ""))
            db.add(campaign)
        campaign.external_id = raw_campaign["nccCampaignId"]
        campaign.campaign_type = raw_campaign.get("campaignTp")
        campaign.is_active = not raw_campaign.get("delFlag", False)
        db.flush()
        result.campaigns += 1

        for raw_group in client.adgroups(campaign.external_id):
            adgroup = db.scalar(
                select(AdGroup).where(
                    AdGroup.campaign_id == campaign.id, AdGroup.external_id == raw_group["nccAdgroupId"]
                )
            ) or db.scalar(
                select(AdGroup).where(
                    AdGroup.campaign_id == campaign.id, AdGroup.name == raw_group.get("name", "")
                )
            )
            if adgroup is None:
                adgroup = AdGroup(
                    account_id=account.id, campaign_id=campaign.id, name=raw_group.get("name", "")
                )
                db.add(adgroup)
            adgroup.external_id = raw_group["nccAdgroupId"]
            adgroup.is_active = not raw_group.get("delFlag", False)
            db.flush()
            result.adgroups += 1

            for raw_keyword in client.keywords(adgroup.external_id):
                text = raw_keyword.get("keyword", "")
                if not text:
                    continue
                keyword = db.scalar(
                    select(Keyword).where(
                        Keyword.account_id == account.id,
                        Keyword.adgroup_id == adgroup.id,
                        Keyword.text == text,
                    )
                )
                if keyword is None:
                    keyword = Keyword(
                        account_id=account.id,
                        campaign_id=campaign.id,
                        adgroup_id=adgroup.id,
                        text=text,
                        normalized_text=normalize(text),
                        family_root=keyword_family_root(text),
                    )
                    db.add(keyword)
                keyword.external_id = raw_keyword.get("nccKeywordId")
                keyword.is_active = not raw_keyword.get("delFlag", False)
                ensure_classification(db, text)
                result.keywords += 1

            for raw_ad in client.ads(adgroup.external_id):
                ad_detail = raw_ad.get("ad", {}) or {}
                creative = db.scalar(
                    select(Creative).where(Creative.external_id == raw_ad.get("nccAdId"))
                )
                if creative is None:
                    creative = Creative(account_id=account.id, adgroup_id=adgroup.id)
                    db.add(creative)
                creative.external_id = raw_ad.get("nccAdId")
                creative.adgroup_id = adgroup.id
                creative.headline = ad_detail.get("headline")
                creative.description = ad_detail.get("description")
                pc = ad_detail.get("pc") if isinstance(ad_detail.get("pc"), dict) else {}
                creative.display_url = pc.get("display")
                creative.landing_url = pc.get("final")
                creative.is_active = not raw_ad.get("delFlag", False)
                result.creatives += 1

    db.commit()
    return result


def sync_stats(
    db: Session, account: Account, client: NaverSearchAdClient, start: date, end: date
) -> SyncResult:
    """키워드 일별 성과를 동기화한다 (id 기준 /stats 조회)."""
    result = SyncResult(account=account.name)
    keywords = list(
        db.scalars(
            select(Keyword).where(Keyword.account_id == account.id, Keyword.external_id.isnot(None))
        )
    )
    if not keywords:
        result.errors.append("동기화된 키워드가 없습니다. 먼저 sync_structure 를 실행하세요.")
        return result

    fields = ["impCnt", "clkCnt", "salesAmt", "avgRnk", "ccnt", "convAmt"]
    time_range = {"since": start.isoformat(), "until": end.isoformat()}

    for chunk_start in range(0, len(keywords), 100):
        chunk = keywords[chunk_start : chunk_start + 100]
        by_external = {k.external_id: k for k in chunk}
        try:
            payload = client.stats(
                [k.external_id for k in chunk], fields, time_range, breakdown="statDt"
            )
        except Exception as error:  # 부분 실패가 전체 동기화를 막지 않도록
            result.errors.append(str(error))
            continue

        for row in (payload or {}).get("data", []):
            keyword = by_external.get(row.get("id"))
            if keyword is None:
                continue
            stat_date = date.fromisoformat(row["statDt"][:10]) if row.get("statDt") else end
            classification = ensure_classification(db, keyword.text)
            existing = db.scalar(
                select(KeywordStatDaily).where(
                    KeywordStatDaily.account_id == account.id,
                    KeywordStatDaily.stat_date == stat_date,
                    KeywordStatDaily.keyword_id == keyword.id,
                    KeywordStatDaily.device == "ALL",
                    KeywordStatDaily.source == DataSource.NAVER_API,
                )
            )
            stat = existing or KeywordStatDaily(
                account_id=account.id,
                stat_date=stat_date,
                keyword_id=keyword.id,
                device="ALL",
                source=DataSource.NAVER_API,
            )
            stat.campaign_id = keyword.campaign_id
            stat.adgroup_id = keyword.adgroup_id
            stat.keyword_text = keyword.text
            stat.impressions = int(row.get("impCnt") or 0)
            stat.clicks = int(row.get("clkCnt") or 0)
            stat.cost = float(row.get("salesAmt") or 0.0)
            stat.average_rank = float(row["avgRnk"]) if row.get("avgRnk") else None
            stat.conversions = int(row.get("ccnt") or 0)
            stat.conversion_value = float(row.get("convAmt") or 0.0)
            stat.product_category = classification.category
            stat.classification_confidence = classification.confidence
            stat.trust_status = TrustStatus.UNVERIFIED
            stat.raw_row = row
            if existing is None:
                db.add(stat)
            result.stat_rows += 1

    db.commit()
    return result


def sync_all(db: Session, days: int = 7) -> list[SyncResult]:
    """.env 에 등록된 모든 customer_id 를 동기화한다."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    results: list[SyncResult] = []

    for customer_id, account_name in settings.naver_customers.items():
        account = db.scalar(select(Account).where(Account.name == account_name))
        if account is None:
            results.append(SyncResult(account=account_name, errors=["DB 에 없는 계정명"]))
            continue
        account.naver_customer_id = customer_id
        with NaverSearchAdClient(NaverCredentials.from_settings(customer_id)) as client:
            structure = sync_structure(db, account, client)
            stats = sync_stats(db, account, client, start, end)
        structure.stat_rows = stats.stat_rows
        structure.errors.extend(stats.errors)
        results.append(structure)
    db.commit()
    return results


def retention_metadata() -> dict:
    """리포트별 API 데이터 보존기간 (§31). 미확인 항목은 None 으로 남긴다."""
    return {
        "report_retention_days": REPORT_RETENTION_DAYS,
        "policy": (
            "2025년 1~8월 데이터가 API 로 영구 복원 가능하다고 가정하지 않는다. "
            "케이오마케팅에 원본 RAW REPORT 재발행을 요청하고, 수령 즉시 별도 Archive 로 보관한다."
        ),
    }
