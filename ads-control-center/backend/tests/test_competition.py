"""STEP 5 — Keyword Competition Measurement (§18–19)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import CompetitionPolicy, SeasonState, TrustStatus
from app.demo import dataset as synthetic
from app.models import Account, CompetitionCluster, KeywordStatDaily
from app.services.competition import measure as competition
from app.services.competition.clusters import build_clusters, cluster_parts_for


def _add(db: Session, account_name: str, keyword: str, category: str, day: date,
         clicks: int, cost: float, impressions: int = 1_000) -> None:
    account = db.scalar(select(Account).where(Account.name == account_name))
    db.add(
        KeywordStatDaily(
            account_id=account.id,
            stat_date=day,
            keyword_text=keyword,
            impressions=impressions,
            clicks=clicks,
            cost=cost,
            product_category=category,
            trust_status=TrustStatus.TRUSTED,
        )
    )


def test_cluster_key_uses_search_intent_not_exact_string() -> None:
    """단순 동일 키워드가 아니라 검색의도로 묶는다 (§18)."""
    a = cluster_parts_for("인천 이동식에어컨렌탈", "냉방")
    b = cluster_parts_for("인천 이동식에어컨대여", "냉방")
    c = cluster_parts_for("이동식에어컨렌탈", "냉방")
    assert a.key == b.key            # 렌탈/대여는 같은 의도
    assert a.key != c.key            # 지역 의도와 메인 의도는 다른 경쟁군
    assert a.intent_type == "REGION" and c.intent_type == "MAIN"


def test_clusters_are_persisted(seeded_db: Session) -> None:
    clusters = build_clusters(seeded_db, *synthetic.period(2026))
    assert clusters
    stored = seeded_db.scalars(select(CompetitionCluster)).all()
    assert len(stored) > len(synthetic.PLANS)


def test_multi_account_in_season_is_allowed(db: Session) -> None:
    """냉방 성수기에는 여러 팀 동시 운영도 허용된다 (§19)."""
    day = date(2026, 7, 15)
    for account in ("다다그룹", "타임렌탈", "OMBC", "MBC렌탈", "다있지"):
        _add(db, account, "이동식에어컨렌탈", "냉방", day, clicks=100, cost=250_000)
    db.commit()

    results = competition.measure(db, day, day, as_of=day)
    cluster = next(m for m in results if "이동식에어컨" in m.label)
    assert len(cluster.accounts) == 5
    assert cluster.review_spend == 0.0
    assert cluster.allowed_spend == cluster.total_cost


def test_off_season_bedding_competition_is_flagged(db: Session) -> None:
    """비시즌 침구를 여러 팀이 운영하면 재배치 검토 대상 (§19). OMBC 는 Primary."""
    day = date(2026, 6, 20)  # 침구 비시즌
    for account, cost in (("OMBC", 400_000), ("다다그룹", 300_000), ("킴샵", 200_000), ("마니", 150_000)):
        _add(db, account, "이불렌탈", "침구/이불", day, clicks=50, cost=cost)
    db.commit()

    results = competition.measure(db, day, day, as_of=day)
    cluster = next(m for m in results if m.product_category == "침구/이불")
    assert cluster.season_state == SeasonState.OFF_SEASON
    assert cluster.policy == CompetitionPolicy.PRIMARY_PLUS_CHALLENGER
    assert cluster.primary_account == "OMBC"
    assert cluster.allowed_account_count == 1
    assert cluster.allowed_spend == 400_000        # Primary 비용은 허용
    assert cluster.review_spend == 650_000         # 나머지는 검토 대상
    assert any("삭감 확정이 아니다" in reason for reason in cluster.reasons)


def test_summary_splits_allowed_and_review_spend(seeded_db: Session) -> None:
    """§18 — 두 금액을 분리해서 보여준다."""
    measurements = competition.measure(seeded_db, *synthetic.period(2026))
    summary = competition.summarize(measurements)
    assert summary["allowed_competition_spend"] > 0
    assert "reallocation_review_spend" in summary
    assert summary["multi_account_cluster_count"] >= 1


def test_efficiency_ranking_notes_missing_conversions(db: Session) -> None:
    """전환 데이터가 없으면 그 사실을 명시한다 (§40)."""
    day = date(2026, 12, 10)
    for account in ("다다그룹", "타임렌탈", "OMBC"):
        _add(db, account, "크리스마스트리대여", "크리스마스트리", day, clicks=40, cost=120_000)
    db.commit()

    cluster = next(
        m for m in competition.measure(db, day, day, as_of=day) if m.product_category == "크리스마스트리"
    )
    assert cluster.has_conversion_data is False
    assert any("DATA INSUFFICIENT" in reason for reason in cluster.reasons)
