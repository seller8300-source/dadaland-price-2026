"""검색의도 기준 경쟁군(Intent Cluster) 생성 (§18).

단순히 '문자열이 같은 키워드' 를 모으지 않는다.
  상품군 + 의도유형(메인/지역/행사/용도) + 지역/행사장 + Keyword Family 루트
를 축으로 묶어야 '같은 수요를 두고 경쟁 중인가' 를 볼 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import CompetitionCluster, KeywordStatDaily
from app.services.classification.classifier import extract_intent_signals, keyword_family_root
from app.services.quality.validator import trusted_stats_filter


@dataclass(slots=True)
class ClusterKeyParts:
    product_category: str
    intent_type: str
    scope: str | None
    family_root: str | None

    @property
    def key(self) -> str:
        return ":".join(
            [
                self.product_category or "미분류",
                self.intent_type,
                self.scope or "-",
                self.family_root or "-",
            ]
        )

    @property
    def label(self) -> str:
        scope = f"{self.scope} " if self.scope else ""
        root = self.family_root or ""
        suffix = {"MAIN": "메인", "REGION": "지역", "EVENT": "행사", "USE": "용도"}.get(
            self.intent_type, self.intent_type
        )
        return f"[{self.product_category}] {scope}{root} ({suffix})".strip()


def cluster_parts_for(keyword_text: str, product_category: str | None) -> ClusterKeyParts:
    signals = extract_intent_signals(keyword_text)
    if signals["venue"]:
        intent_type, scope = "EVENT", signals["venue"]
    elif signals["event"]:
        intent_type, scope = "EVENT", signals["region"]
    elif signals["region"]:
        intent_type, scope = "REGION", signals["region"]
    elif signals["use"]:
        intent_type, scope = "USE", signals["use"]
    else:
        intent_type, scope = "MAIN", None
    return ClusterKeyParts(
        product_category=product_category or "미분류",
        intent_type=intent_type,
        scope=scope,
        family_root=keyword_family_root(keyword_text),
    )


@dataclass(slots=True)
class ClusterMembership:
    parts: ClusterKeyParts
    keywords: set[str] = field(default_factory=set)


def build_clusters(db: Session, start: date, end: date, persist: bool = True) -> dict[str, ClusterMembership]:
    """구간 내 실제 집행된 키워드로 클러스터를 만든다."""
    rows = db.execute(
        select(KeywordStatDaily.keyword_text, KeywordStatDaily.product_category)
        .where(
            and_(
                KeywordStatDaily.stat_date >= start,
                KeywordStatDaily.stat_date <= end,
                trusted_stats_filter(),
            )
        )
        .distinct()
    ).all()

    clusters: dict[str, ClusterMembership] = {}
    for keyword_text, product_category in rows:
        if not keyword_text:
            continue
        parts = cluster_parts_for(keyword_text, product_category)
        membership = clusters.setdefault(parts.key, ClusterMembership(parts=parts))
        membership.keywords.add(keyword_text)

    if persist:
        for key, membership in clusters.items():
            existing = db.scalar(
                select(CompetitionCluster).where(CompetitionCluster.cluster_key == key)
            )
            cluster = existing or CompetitionCluster(cluster_key=key)
            cluster.label = membership.parts.label
            cluster.product_category = membership.parts.product_category
            cluster.intent_type = membership.parts.intent_type
            cluster.region = membership.parts.scope
            cluster.member_keywords = sorted(membership.keywords)[:500]
            if existing is None:
                db.add(cluster)
        db.commit()
    return clusters
