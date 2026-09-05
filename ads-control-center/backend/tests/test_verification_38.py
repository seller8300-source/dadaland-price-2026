"""§38 최초 시스템 검증 Test.

과거 데이터를 넣었을 때 명세에 적힌 패턴이 그대로 재현되어야 한다.
이 결과가 나오지 않으면 Import 또는 분석로직부터 재검증한다.
"""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.core.enums import ProductCategory, SpendDriver
from app.demo import dataset as synthetic
from app.services.benchmark.metrics import period_metrics
from app.services.benchmark.yoy import Flag, build_benchmarks, main_intent_metrics
from app.services.policy import rules as policy_rules


@pytest.fixture()
def benchmarks(seeded_db: Session):
    return build_benchmarks(seeded_db, synthetic.period(2025), synthetic.period(2026))


def test_company_baseline_matches_spec(db: Session) -> None:
    """§4 — 회사 전체 2025/2026 1~8월 집계가 명세 수치와 일치한다."""
    synthetic.generate(db)
    base = period_metrics(db, *synthetic.period(2025), include_rejected=True)
    comp = period_metrics(db, *synthetic.period(2026), include_rejected=True)

    assert base.cost == pytest.approx(64_476_115, abs=1)
    assert base.clicks == 52_313
    assert base.cpc == pytest.approx(1_233, abs=2)

    assert comp.cost == pytest.approx(170_957_879, abs=1)
    assert comp.clicks == 93_819
    assert comp.cpc == pytest.approx(1_822, abs=2)

    # 광고비 +165%, 클릭 +79%, CPC +48% (§4)
    assert (comp.cost - base.cost) / base.cost * 100 == pytest.approx(165, abs=1)
    assert (comp.clicks - base.clicks) / base.clicks * 100 == pytest.approx(79, abs=1)
    assert (comp.cpc - base.cpc) / base.cpc * 100 == pytest.approx(48, abs=1)


def test_slow_growth_accounts_spend(db: Session) -> None:
    """§5 — 성장이 둔한 8개 계정의 2026 광고비 약 1억원."""
    synthetic.generate(db)
    total = 0.0
    for plan in synthetic.PLANS:
        if plan.name in {"다다그룹", "타임렌탈"}:
            continue
        total += plan.cost_2026
    assert total == pytest.approx(100_011_734, abs=1)


def test_mani_efficiency_warning(benchmarks) -> None:
    """마니 — CPC 급등 + CTR 하락 경고."""
    entry = benchmarks.by_name("마니")
    assert Flag.EFFICIENCY_WARNING in entry.flags
    assert entry.decomposition.cpc_change_pct == pytest.approx(153, abs=3)
    assert entry.decomposition.ctr_change_pct == pytest.approx(-65, abs=2)
    assert entry.decomposition.primary_driver == SpendDriver.B_CPC_RISE


def test_mbc_cpc_up_ctr_down(benchmarks) -> None:
    """MBC렌탈 — CPC 상승 + CTR 하락."""
    entry = benchmarks.by_name("MBC렌탈")
    assert Flag.CPC_UP_CTR_DOWN in entry.flags
    assert entry.decomposition.cpc_change_pct > 10
    assert entry.decomposition.ctr_change_pct < -10


def test_kimshop_is_expansion_type(benchmarks) -> None:
    """킴샵 — 비용 증가보다 클릭 증가가 더 큰 확대형 계정."""
    entry = benchmarks.by_name("킴샵")
    assert Flag.EXPANSION_TYPE in entry.flags
    assert entry.decomposition.click_change_pct > entry.decomposition.cost_change_pct
    assert entry.decomposition.cpc_change_pct < 0


def test_eurachacha_click_expansion_with_data_warning(benchmarks) -> None:
    """으라차차 — CPC 상승이 주원인이 아닌 클릭 확장형 + Excel 데이터 오류 경고."""
    entry = benchmarks.by_name("으라차차")
    assert entry.decomposition.primary_driver == SpendDriver.A_CLICK_GROWTH
    assert abs(entry.decomposition.cpc_change_pct) < 10
    assert Flag.CLICK_EXPANSION in entry.flags
    assert Flag.DATA_QUALITY_BLOCKED in entry.flags
    assert any("데이터 오류" in note for note in entry.notes)


def test_billymarket_is_low_cpc(benchmarks) -> None:
    """빌리마켓 — 상대적인 저CPC 계정 (일괄삭감 대상 아님)."""
    entry = benchmarks.by_name("빌리마켓")
    assert Flag.LOW_CPC_ACCOUNT in entry.flags
    assert any("일괄삭감 대상이 아니다" in note for note in entry.notes)


def test_ombc_volume_leader_and_bedding_primary(benchmarks) -> None:
    """OMBC — Slow-growth 그룹 최대 Volume 계정 + 이불 Primary."""
    entry = benchmarks.by_name("OMBC")
    assert Flag.VOLUME_LEADER_SLOW_GROWTH in entry.flags
    assert Flag.BEDDING_PRIMARY in entry.flags
    # 광고비가 가장 크다는 것이 가장 효율적이라는 뜻은 아니다 (§6)
    assert Flag.EFFICIENCY_BENCHMARK_CANDIDATE not in entry.flags
    slow_growth = [e for e in benchmarks.accounts if not e.is_growth_account]
    assert max(slow_growth, key=lambda e: e.comp.cost).account_name == "OMBC"


def test_daitzi_cooling_benchmark_candidate(benchmarks, seeded_db: Session) -> None:
    """다있지 — 냉방 효율 Benchmark 후보 + 1위 고정운영 경고."""
    entry = benchmarks.by_name("다있지")
    assert Flag.EFFICIENCY_BENCHMARK_CANDIDATE in entry.flags
    assert Flag.TOP_RANK_FIXED_WARNING in entry.flags
    assert any("최종 우승 계정으로 고정하지 않는다" in note for note in entry.notes)

    cooling = main_intent_metrics(seeded_db, synthetic.period(2026), ProductCategory.COOLING)
    daitzi = cooling[entry.account_id]
    assert daitzi["cpc"] == pytest.approx(2_427, rel=0.08)   # §6 냉방 CPC 약 2,427원
    assert daitzi["ctr"] == pytest.approx(6.89, rel=0.05)    # §6 냉방 CTR 약 6.89%
    assert daitzi["cpc"] == min(v["cpc"] for v in cooling.values())


def test_hyundai_dock_policy_violation(seeded_db: Session) -> None:
    """현대도크 — 물류 외 광고 정책위반 탐지 (§6)."""
    violations = policy_rules.detect_violations(seeded_db, *synthetic.period(2026))
    dock = [v for v in violations if v.account_name == "현대도크"]
    assert dock, "현대도크의 물류 외 광고가 탐지되지 않았습니다."
    assert any(v.product_category == ProductCategory.HEATING for v in dock)
    assert all(v.product_category != ProductCategory.LOGISTICS for v in dock)

    alerts = policy_rules.record_violation_alerts(seeded_db, dock, synthetic.period(2026)[1])
    assert alerts and "POLICY_VIOLATION" in alerts[0].title


def test_growth_accounts_evaluated_separately(benchmarks) -> None:
    """다다그룹/타임렌탈 — 매출 성장계정은 별도 평가하며, 타임렌탈은 지역키워드 Benchmark."""
    for name in ("다다그룹", "타임렌탈"):
        entry = benchmarks.by_name(name)
        assert Flag.GROWTH_ACCOUNT in entry.flags
        assert Flag.EFFICIENCY_WARNING not in entry.flags
        assert any("매출/기여이익 증가율" in note for note in entry.notes)

    time_rental = benchmarks.by_name("타임렌탈")
    assert Flag.REGION_KEYWORD_BENCHMARK in time_rental.flags


def test_company_cost_increase_is_explained(benchmarks) -> None:
    """§12 — 광고비 증가 이유를 한 문장으로 설명한다."""
    explanation = benchmarks.company_decomposition.explanation
    assert "광고비" in explanation
    assert "클릭" in explanation and "CPC" in explanation
    # 전체 증가는 클릭·CPC 동시 상승 (§4)
    assert benchmarks.company_decomposition.primary_driver == SpendDriver.C_CLICK_AND_CPC
