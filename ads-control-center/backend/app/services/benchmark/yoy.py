"""STEP 3 — 2025 vs 2026 동일기간 Benchmark 생성 (§4, §6, §38).

계정별로 지표를 비교하고, 사람이 읽을 수 있는 '패턴 플래그'를 붙인다.
플래그는 판정이 아니라 '무엇을 먼저 확인해야 하는가' 의 우선순위다 (§11).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import ProductCategory
from app.models import Account, DataQualityWarning
from app.services.benchmark.metrics import (
    Metrics,
    category_breakdown,
    period_metrics,
    rejected_keywords,
)
from app.services.benchmark.spend_driver import SpendDecomposition, decompose, one_sentence

# 플래그 임계치 — 전부 상대 비교이며 절대 금지 판단(§11)을 하지 않는다.
CPC_SPIKE_PCT = 30.0
CPC_RISE_PCT = 10.0
CTR_DROP_PCT = -30.0
CTR_SLIP_PCT = -10.0
LOW_CPC_RATIO = 0.85          # peer 중앙값 대비
HIGH_CTR_RATIO = 1.15
TOP_RANK_THRESHOLD = 1.5      # 평균순위가 이보다 앞이면 상위 고정운영 의심
EXPANSION_GAP_PCT = 5.0       # 클릭 증가율이 비용 증가율보다 이만큼 크면 확대형
MIN_BENCHMARK_CLICKS = 300    # 이보다 적은 클릭으로 Benchmark 를 단정하지 않는다


class Flag:
    EFFICIENCY_WARNING = "EFFICIENCY_WARNING"
    CPC_UP_CTR_DOWN = "CPC_UP_CTR_DOWN"
    EXPANSION_TYPE = "EXPANSION_TYPE"
    CLICK_EXPANSION = "CLICK_EXPANSION"
    LOW_CPC_ACCOUNT = "LOW_CPC_ACCOUNT"
    VOLUME_LEADER_SLOW_GROWTH = "VOLUME_LEADER_SLOW_GROWTH"
    EFFICIENCY_BENCHMARK_CANDIDATE = "EFFICIENCY_BENCHMARK_CANDIDATE"
    TOP_RANK_FIXED_WARNING = "TOP_RANK_FIXED_WARNING"
    GROWTH_ACCOUNT = "GROWTH_ACCOUNT"
    REGION_KEYWORD_BENCHMARK = "REGION_KEYWORD_BENCHMARK"
    BEDDING_PRIMARY = "BEDDING_PRIMARY"
    DATA_QUALITY_BLOCKED = "DATA_QUALITY_BLOCKED"
    POLICY_VIOLATION = "POLICY_VIOLATION"


FLAG_TEXT = {
    Flag.EFFICIENCY_WARNING: "Efficiency Warning — CPC 급등 + CTR 급락",
    Flag.CPC_UP_CTR_DOWN: "CPC 상승 + CTR 하락",
    Flag.EXPANSION_TYPE: "확대형 — 비용 증가보다 클릭 증가가 큼",
    Flag.CLICK_EXPANSION: "클릭 확장형 — CPC 상승이 주원인이 아님",
    Flag.LOW_CPC_ACCOUNT: "상대적 저CPC 계정",
    Flag.VOLUME_LEADER_SLOW_GROWTH: "Slow-growth 그룹 최대 Volume 계정",
    Flag.EFFICIENCY_BENCHMARK_CANDIDATE: "냉방 Efficiency Benchmark Candidate (전환 데이터 확보 전 확정 아님)",
    Flag.TOP_RANK_FIXED_WARNING: "상위(1위권) 고정운영 경고",
    Flag.GROWTH_ACCOUNT: "매출 성장계정 — 광고비 증가만으로 비효율 판정하지 않음",
    Flag.REGION_KEYWORD_BENCHMARK: "지역키워드 Benchmark 사례",
    Flag.BEDDING_PRIMARY: "이불/침구 Primary 계정",
    Flag.DATA_QUALITY_BLOCKED: "Excel 데이터 오류 — 상세 판단 보류",
    Flag.POLICY_VIOLATION: "정책위반 광고 탐지",
}


@dataclass(slots=True)
class AccountBenchmark:
    account_id: int
    account_name: str
    is_growth_account: bool
    base: Metrics
    comp: Metrics
    decomposition: SpendDecomposition
    flags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    category_mix: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "account_id": self.account_id,
            "account": self.account_name,
            "is_growth_account": self.is_growth_account,
            "base": self.base.as_dict(),
            "comp": self.comp.as_dict(),
            "cost_change_pct": self.decomposition.cost_change_pct,
            "click_change_pct": self.decomposition.click_change_pct,
            "cpc_change_pct": self.decomposition.cpc_change_pct,
            "ctr_change_pct": self.decomposition.ctr_change_pct,
            "primary_driver": self.decomposition.primary_driver,
            "explanation": self.decomposition.explanation,
            "flags": self.flags,
            "flag_texts": [FLAG_TEXT.get(f, f) for f in self.flags],
            "notes": self.notes,
            "category_mix": self.category_mix,
        }


@dataclass(slots=True)
class BenchmarkSet:
    base_period: tuple[date, date]
    comp_period: tuple[date, date]
    company_base: Metrics
    company_comp: Metrics
    company_decomposition: SpendDecomposition
    accounts: list[AccountBenchmark] = field(default_factory=list)

    def by_name(self, name: str) -> AccountBenchmark | None:
        return next((a for a in self.accounts if a.account_name == name), None)

    def as_dict(self) -> dict:
        return {
            "base_period": [d.isoformat() for d in self.base_period],
            "comp_period": [d.isoformat() for d in self.comp_period],
            "company": {
                "base": self.company_base.as_dict(),
                "comp": self.company_comp.as_dict(),
                "cost_change_pct": self.company_decomposition.cost_change_pct,
                "click_change_pct": self.company_decomposition.click_change_pct,
                "cpc_change_pct": self.company_decomposition.cpc_change_pct,
                "explanation": self.company_decomposition.explanation,
            },
            "accounts": [a.as_dict() for a in self.accounts],
        }


def _blocked_account_ids(db: Session) -> set[int]:
    rows = db.scalars(
        select(DataQualityWarning.account_id).where(DataQualityWarning.blocks_analysis.is_(True))
    ).all()
    return {row for row in rows if row}


def build_benchmarks(
    db: Session,
    base_period: tuple[date, date],
    comp_period: tuple[date, date],
) -> BenchmarkSet:
    """전 계정 YoY Benchmark 를 만든다."""
    accounts = list(db.scalars(select(Account).where(Account.is_active.is_(True))))
    blocked = _blocked_account_ids(db)

    entries: list[AccountBenchmark] = []
    for account in accounts:
        # 데이터 오류로 버려진 키워드는 양쪽 기간에서 함께 제외한다 (like-for-like).
        excluded = rejected_keywords(db, account.id)
        base = period_metrics(db, base_period[0], base_period[1], account.id, exclude_keywords=excluded)
        comp = period_metrics(db, comp_period[0], comp_period[1], account.id, exclude_keywords=excluded)
        if base.cost == 0 and comp.cost == 0:
            continue
        decomposition = decompose(base, comp)
        decomposition.explanation = one_sentence(decomposition)
        entries.append(
            AccountBenchmark(
                account_id=account.id,
                account_name=account.name,
                is_growth_account=account.is_growth_account,
                base=base,
                comp=comp,
                decomposition=decomposition,
                category_mix=category_breakdown(db, comp_period[0], comp_period[1], account.id),
            )
        )
        if excluded:
            entries[-1].notes.append(
                "데이터 오류가 확인된 키워드 "
                + ", ".join(sorted(excluded)[:5])
                + f" ({len(excluded)}개) 는 비교에서 제외했습니다 (§9)."
            )

    _apply_flags(db, entries, blocked, comp_period)

    company_base = period_metrics(db, base_period[0], base_period[1])
    company_comp = period_metrics(db, comp_period[0], comp_period[1])
    company_decomposition = decompose(company_base, company_comp)
    company_decomposition.explanation = one_sentence(company_decomposition)

    return BenchmarkSet(
        base_period=base_period,
        comp_period=comp_period,
        company_base=company_base,
        company_comp=company_comp,
        company_decomposition=company_decomposition,
        accounts=sorted(entries, key=lambda e: e.comp.cost, reverse=True),
    )


def main_intent_metrics(
    db: Session, period: tuple[date, date], product_category: str
) -> dict[int, dict]:
    """계정별 '메인 의도' 성과 — 지역/행사장/용도 롱테일을 제외한 순수 상품 키워드.

    지역키워드는 구조적으로 CPC 가 낮고 CTR 이 높다. 그것과 메인키워드를 섞어
    비교하면 효율 Benchmark 판단이 왜곡된다 (§18 검색의도 기준 비교).
    """
    from app.models import KeywordStatDaily
    from app.services.classification.classifier import extract_intent_signals
    from app.services.quality.validator import trusted_stats_filter

    rows = db.execute(
        select(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.impressions,
            KeywordStatDaily.clicks,
            KeywordStatDaily.cost,
            KeywordStatDaily.average_rank,
        ).where(
            KeywordStatDaily.stat_date >= period[0],
            KeywordStatDaily.stat_date <= period[1],
            KeywordStatDaily.product_category == product_category,
            trusted_stats_filter(),
        )
    ).all()

    aggregated: dict[int, dict] = {}
    for account_id, keyword_text, impressions, clicks, cost, rank in rows:
        if not keyword_text or account_id is None:
            continue
        signals = extract_intent_signals(keyword_text)
        if signals["region"] or signals["venue"] or signals["event"] or signals["use"]:
            continue  # 롱테일은 별도 비교군
        bucket = aggregated.setdefault(
            account_id,
            {"impressions": 0, "clicks": 0, "cost": 0.0, "rank_sum": 0.0, "rank_weight": 0.0},
        )
        clicks = int(clicks or 0)
        bucket["impressions"] += int(impressions or 0)
        bucket["clicks"] += clicks
        bucket["cost"] += float(cost or 0.0)
        if rank and clicks:
            bucket["rank_sum"] += float(rank) * clicks
            bucket["rank_weight"] += clicks

    result: dict[int, dict] = {}
    for account_id, bucket in aggregated.items():
        if not bucket["clicks"]:
            continue
        result[account_id] = {
            "cost": bucket["cost"],
            "clicks": bucket["clicks"],
            "impressions": bucket["impressions"],
            "cpc": bucket["cost"] / bucket["clicks"],
            "ctr": (bucket["clicks"] / bucket["impressions"] * 100) if bucket["impressions"] else None,
            "rank": (bucket["rank_sum"] / bucket["rank_weight"]) if bucket["rank_weight"] else None,
        }
    return result


def _median(values: list[float]) -> float | None:
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def _primary_accounts(db: Session) -> dict[int, list[str]]:
    """상품군별 Primary 계정 (§19 이불 = OMBC)."""
    from app.models import BusinessRule

    primary: dict[int, list[str]] = {}
    for rule in db.scalars(
        select(BusinessRule).where(
            BusinessRule.rule_type == "PRIMARY_ACCOUNT", BusinessRule.is_active.is_(True)
        )
    ):
        if rule.account_id and rule.product_category:
            primary.setdefault(rule.account_id, []).append(rule.product_category)
    return primary


def _high_intent_metrics(db: Session, period: tuple[date, date]) -> dict[int, dict]:
    """계정별 고의도(지역/행사장 + 렌탈) 키워드 성과 (§15–16)."""
    from app.models import KeywordStatDaily
    from app.services.classification.classifier import extract_intent_signals
    from app.services.quality.validator import trusted_stats_filter

    rows = db.execute(
        select(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.impressions,
            KeywordStatDaily.clicks,
            KeywordStatDaily.cost,
        ).where(
            KeywordStatDaily.stat_date >= period[0],
            KeywordStatDaily.stat_date <= period[1],
            trusted_stats_filter(),
        )
    ).all()

    aggregated: dict[int, dict] = {}
    for account_id, keyword_text, impressions, clicks, cost in rows:
        if not keyword_text or account_id is None:
            continue
        signals = extract_intent_signals(keyword_text)
        if not (signals["rental"] and (signals["region"] or signals["venue"])):
            continue
        bucket = aggregated.setdefault(account_id, {"impressions": 0, "clicks": 0, "cost": 0.0})
        bucket["impressions"] += int(impressions or 0)
        bucket["clicks"] += int(clicks or 0)
        bucket["cost"] += float(cost or 0.0)

    return {
        account_id: {
            **bucket,
            "cpc": bucket["cost"] / bucket["clicks"] if bucket["clicks"] else None,
            "ctr": bucket["clicks"] / bucket["impressions"] * 100 if bucket["impressions"] else None,
        }
        for account_id, bucket in aggregated.items()
        if bucket["clicks"]
    }


def _apply_flags(
    db: Session,
    entries: list[AccountBenchmark],
    blocked: set[int],
    comp_period: tuple[date, date],
) -> None:
    """peer 비교가 필요한 플래그는 전 계정을 모은 뒤 한 번에 계산한다."""
    peer_cpc = _median([e.comp.cpc for e in entries if e.comp.cpc])
    primary_accounts = _primary_accounts(db)
    high_intent = _high_intent_metrics(db, comp_period)
    high_intent_ctr_median = _median([v["ctr"] for v in high_intent.values()])
    slow_growth = [e for e in entries if not e.is_growth_account]
    volume_leader = max(slow_growth, key=lambda e: e.comp.cost, default=None)

    # 냉방 효율 비교는 '같은 검색의도' 안에서만 한다 (§18).
    # 지역/행사/용도 롱테일은 구조가 달라 메인 냉방과 같은 잣대로 비교하지 않는다.
    cooling_stats = main_intent_metrics(db, comp_period, ProductCategory.COOLING)
    cooling_cpc_median = _median([v["cpc"] for v in cooling_stats.values()])
    cooling_ctr_median = _median([v["ctr"] for v in cooling_stats.values()])

    for entry in entries:
        cpc_change = entry.decomposition.cpc_change_pct
        ctr_change = entry.decomposition.ctr_change_pct
        cost_change = entry.decomposition.cost_change_pct
        click_change = entry.decomposition.click_change_pct

        if entry.is_growth_account:
            entry.flags.append(Flag.GROWTH_ACCOUNT)
            entry.notes.append("광고비 증가율 대신 매출/기여이익 증가율로 평가한다 (§3).")

        if cpc_change is not None and ctr_change is not None:
            if cpc_change >= CPC_SPIKE_PCT and ctr_change <= CTR_DROP_PCT:
                entry.flags.append(Flag.EFFICIENCY_WARNING)
                entry.notes.append("고CPC 키워드 및 과도한 상위노출 여부를 가장 먼저 확인한다.")
            if cpc_change >= CPC_RISE_PCT and ctr_change <= CTR_SLIP_PCT:
                entry.flags.append(Flag.CPC_UP_CTR_DOWN)
                entry.notes.append("평균순위·랜딩페이지·소재·실제 검색어를 우선 분석한다.")

        if cost_change is not None and click_change is not None:
            if click_change - cost_change >= EXPANSION_GAP_PCT and (cpc_change or 0) < 0:
                entry.flags.append(Flag.EXPANSION_TYPE)
                entry.notes.append("입찰보다 유입 품질·실제 검색어·랜딩·전환을 확인한다.")
            elif abs(click_change - cost_change) < EXPANSION_GAP_PCT and abs(cpc_change or 0) < CPC_RISE_PCT:
                entry.flags.append(Flag.CLICK_EXPANSION)
                entry.notes.append("CPC 상승이 주원인이 아니다. 클릭의 질과 전환을 먼저 의심한다.")

        if peer_cpc and entry.comp.cpc and entry.comp.cpc <= peer_cpc * LOW_CPC_RATIO:
            entry.flags.append(Flag.LOW_CPC_ACCOUNT)
            entry.notes.append("저비용 고의도 키워드 발굴 Benchmark 후보. 일괄삭감 대상이 아니다.")

        if volume_leader is not None and entry.account_id == volume_leader.account_id:
            entry.flags.append(Flag.VOLUME_LEADER_SLOW_GROWTH)
            entry.notes.append("광고비 규모가 크다는 것이 효율이 가장 좋다는 뜻은 아니다 (§6).")

        cooling = cooling_stats.get(entry.account_id)
        if cooling and cooling_cpc_median and cooling_ctr_median and cooling["clicks"] >= MIN_BENCHMARK_CLICKS:
            if (
                cooling["cpc"] <= cooling_cpc_median * LOW_CPC_RATIO
                and cooling["ctr"] >= cooling_ctr_median * HIGH_CTR_RATIO
            ):
                entry.flags.append(Flag.EFFICIENCY_BENCHMARK_CANDIDATE)
                entry.notes.append(
                    f"냉방 CPC {cooling['cpc']:.0f}원 / CTR {cooling['ctr']:.2f}% — "
                    "전환 데이터가 붙기 전까지 최종 우승 계정으로 고정하지 않는다 (§6)."
                )
            if cooling["rank"] is not None and cooling["rank"] <= TOP_RANK_THRESHOLD:
                entry.flags.append(Flag.TOP_RANK_FIXED_WARNING)
                entry.notes.append("1위 고정운영 여부와 순위별 전환 차이를 비교한다 (§13).")

        for category in primary_accounts.get(entry.account_id, []):
            category_cost = entry.category_mix.get(category, {}).get("cost", 0)
            if category_cost:
                entry.flags.append(Flag.BEDDING_PRIMARY)
                entry.notes.append(
                    f"{category} Primary 계정 — 비시즌 단독 운영, 성수기에만 1~2개 팀 경쟁 허용 (§19)."
                )

        intent = high_intent.get(entry.account_id)
        if (
            intent
            and high_intent_ctr_median
            and intent["clicks"] >= MIN_BENCHMARK_CLICKS
            and intent["ctr"] >= high_intent_ctr_median * HIGH_CTR_RATIO
        ):
            entry.flags.append(Flag.REGION_KEYWORD_BENCHMARK)
            entry.notes.append(
                f"지역+상품+렌탈 구조 CTR {intent['ctr']:.1f}% / CPC {intent['cpc']:,.0f}원 — "
                "지역키워드 Benchmark 사례 (§16)."
            )

        if entry.account_id in blocked:
            entry.flags.append(Flag.DATA_QUALITY_BLOCKED)
            entry.notes.append("Excel 데이터 오류가 확인되어 API 연결 전까지 상세 판단을 금지한다 (§9).")


def high_intent_region_benchmark(
    db: Session, period: tuple[date, date], min_clicks: int = 30
) -> list[dict]:
    """지역 + 상품 + 렌탈 구조의 성과 Benchmark (§6 타임렌탈, §15, §16)."""
    from app.models import KeywordStatDaily
    from app.services.classification.classifier import extract_intent_signals
    from app.services.quality.validator import trusted_stats_filter

    rows = db.execute(
        select(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.impressions,
            KeywordStatDaily.clicks,
            KeywordStatDaily.cost,
            KeywordStatDaily.conversions,
        ).where(
            KeywordStatDaily.stat_date >= period[0],
            KeywordStatDaily.stat_date <= period[1],
            trusted_stats_filter(),
        )
    ).all()

    accounts = {a.id: a.name for a in db.scalars(select(Account)).all()}
    aggregated: dict[tuple[int, str], dict] = {}
    for account_id, keyword_text, impressions, clicks, cost, conversions in rows:
        if not keyword_text:
            continue
        signals = extract_intent_signals(keyword_text)
        if not (signals["rental"] and (signals["region"] or signals["venue"])):
            continue
        key = (account_id, signals["region"] or signals["venue"])
        bucket = aggregated.setdefault(
            key,
            {"account": accounts.get(account_id), "region": key[1],
             "impressions": 0, "clicks": 0, "cost": 0.0, "conversions": 0, "keywords": set()},
        )
        bucket["impressions"] += int(impressions or 0)
        bucket["clicks"] += int(clicks or 0)
        bucket["cost"] += float(cost or 0.0)
        bucket["conversions"] += int(conversions or 0)
        bucket["keywords"].add(keyword_text)

    results = []
    for bucket in aggregated.values():
        if bucket["clicks"] < min_clicks:
            continue
        results.append(
            {
                "account": bucket["account"],
                "region": bucket["region"],
                "keywords": len(bucket["keywords"]),
                "impressions": bucket["impressions"],
                "clicks": bucket["clicks"],
                "cost": round(bucket["cost"], 1),
                "conversions": bucket["conversions"],
                "ctr": round(bucket["clicks"] / bucket["impressions"] * 100, 2) if bucket["impressions"] else None,
                "cpc": round(bucket["cost"] / bucket["clicks"], 1) if bucket["clicks"] else None,
            }
        )
    return sorted(results, key=lambda r: (r["ctr"] or 0), reverse=True)
