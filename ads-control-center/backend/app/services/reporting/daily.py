"""STEP 6 — Daily CEO Report (§27).

CEO 가 3분 안에 읽을 수 있어야 한다. 구조:
    1. 회사 전체 (어제/7일평균/이번달 누적/월말 예상/상품군 비중/YoY/광고비율)
    2. 매출 생산성
    3. 우선 확인 팀
    4. 이상징후 (정책위반 포함)
    5. Keyword Competition (허용 vs 재배치 검토)
    6. Opportunity (Confidence 70 이상만)
    7. 케이오마케팅 전달 권고 — 실제 실행지시 형태
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import AlertLevel
from app.models import Account
from app.services.benchmark.metrics import category_breakdown, pct_change, period_metrics
from app.services.benchmark.spend_driver import explain_cost_change
from app.services.competition import measure as competition
from app.services.conversion import tracking
from app.services.opportunity import engine as opportunity_engine
from app.services.policy import rules as policy_rules
from app.services.productivity import revenue as productivity
from app.services.reporting import anomaly as anomaly_service
from app.services.season.predictor import refresh_indices, upcoming_season_alerts

POLICY_LOOKBACK_DAYS = 90  # 정책위반 점검 구간 (§6)

LEVEL_ICON = {
    AlertLevel.CRITICAL: "🔴",
    AlertLevel.WARNING: "🔴",
    AlertLevel.WATCH: "🟡",
    AlertLevel.INFO: "🟢",
}


@dataclass(slots=True)
class DailyReport:
    as_of: date
    company: dict
    productivity: list[dict]
    priority_accounts: list[dict]
    anomalies: list[dict]
    policy_violations: list[dict]
    competition: dict
    opportunities: list[dict]
    season: list[dict]
    conversion_tracking: dict
    agency_instructions: list[str]
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["as_of"] = self.as_of.isoformat()
        return payload


def _same_period_last_year(period: tuple[date, date]) -> tuple[date, date]:
    start, end = period
    try:
        return start.replace(year=start.year - 1), end.replace(year=end.year - 1)
    except ValueError:  # 2월 29일
        return start.replace(year=start.year - 1, day=28), end.replace(year=end.year - 1, day=28)


def build(db: Session, as_of: date | None = None) -> DailyReport:
    """어제 기준 일일 리포트를 만든다."""
    as_of = as_of or (date.today() - timedelta(days=1))
    month_start = as_of.replace(day=1)
    week_start = as_of - timedelta(days=7)
    week_end = as_of - timedelta(days=1)

    yesterday = period_metrics(db, as_of, as_of)
    trailing = period_metrics(db, week_start, week_end)
    trailing_daily_cost = trailing.cost / 7 if trailing.cost else 0.0
    month = productivity.month_projection(db, None, as_of)

    ytd_period = (date(as_of.year, 1, 1), as_of)
    last_year_period = _same_period_last_year(ytd_period)
    yoy = explain_cost_change(db, *last_year_period, *ytd_period)
    productivity_rows = productivity.company_productivity(db, last_year_period, ytd_period)
    company_productivity = productivity_rows[0]

    company = {
        "yesterday_cost": round(yesterday.cost, 1),
        "yesterday_clicks": yesterday.clicks,
        "yesterday_cpc": round(yesterday.cpc, 1) if yesterday.cpc else None,
        "vs_7day_avg_pct": round(pct_change(trailing_daily_cost, yesterday.cost), 1)
        if trailing_daily_cost
        else None,
        "month_to_date_cost": month["month_to_date_cost"],
        "projected_month_cost": month["projected_month_cost"],
        "category_mix": category_breakdown(db, month_start, as_of),
        "yoy": {
            "period": [d.isoformat() for d in ytd_period],
            "base_period": [d.isoformat() for d in last_year_period],
            "cost_change_pct": yoy.cost_change_pct,
            "click_change_pct": yoy.click_change_pct,
            "cpc_change_pct": yoy.cpc_change_pct,
            "revenue_change_pct": company_productivity.revenue_change_pct,
            "ad_cost_ratio_pct": round(company_productivity.ad_cost_ratio_after * 100, 1)
            if company_productivity.ad_cost_ratio_after
            else None,
            "explanation": yoy.explanation,
        },
        "breakeven": productivity.breakeven_scenarios(
            month["month_to_date_cost"], productivity.margin_rate_for(db, None)
        ),
    }

    anomalies = anomaly_service.detect(db, as_of)
    anomaly_service.persist(db, anomalies, as_of)

    # 정책위반은 간헐적으로 집행돼도 놓치면 안 되므로 이번달이 아니라 최근 구간 전체를 본다.
    violations = policy_rules.detect_violations(
        db, as_of - timedelta(days=POLICY_LOOKBACK_DAYS), as_of
    )
    policy_rules.record_violation_alerts(db, violations, as_of)
    db.commit()

    priority = _priority_accounts(db, as_of, anomalies, violations)

    measurements = competition.measure(db, week_start, as_of)
    competition_summary = competition.summarize(measurements)

    candidates = opportunity_engine.generate(db, as_of)
    opportunities = opportunity_engine.for_ceo_report(candidates)

    season_assessments = refresh_indices(db, as_of)
    season_alerts = upcoming_season_alerts(season_assessments, as_of)

    conversion_status = tracking.coverage(db, month_start, as_of)
    funnel = tracking.funnel(db, month_start, as_of)
    conversion_status["funnel"] = funnel

    report = DailyReport(
        as_of=as_of,
        company=company,
        productivity=[row.as_dict() for row in productivity_rows],
        priority_accounts=priority,
        anomalies=[a.as_dict() for a in anomalies],
        policy_violations=[v.as_dict() for v in violations],
        competition=competition_summary,
        opportunities=opportunities,
        season=season_alerts,
        conversion_tracking=conversion_status,
        agency_instructions=[],
    )
    report.agency_instructions = build_agency_instructions(report)

    if funnel["status"].startswith("DATA INSUFFICIENT"):
        report.notes.append(
            "전환 데이터가 아직 없습니다 — 매출 기여 판단은 STEP 0 전환추적 수집 이후 가능합니다."
        )
    if company_productivity.verdict == productivity.Verdict.DATA_INSUFFICIENT:
        report.notes.append(
            "매출 데이터 미연동 — 광고비 증감만으로 효율을 판정하지 않습니다 (§11)."
        )
    return report


def _priority_accounts(
    db: Session,
    as_of: date,
    anomalies: list[anomaly_service.Anomaly],
    violations: list[policy_rules.PolicyViolation],
) -> list[dict]:
    """오늘 먼저 확인할 팀 (§27 '우선 확인 팀')."""
    scores: dict[str, dict] = {}
    weight = {AlertLevel.CRITICAL: 100, AlertLevel.WARNING: 40, AlertLevel.WATCH: 15, AlertLevel.INFO: 5}

    for item in anomalies:
        bucket = scores.setdefault(
            item.account_name, {"account": item.account_name, "score": 0, "reasons": [], "icon": "🟡"}
        )
        bucket["score"] += weight.get(item.level, 10)
        bucket["reasons"].append(item.message)
        if item.level in (AlertLevel.CRITICAL, AlertLevel.WARNING):
            bucket["icon"] = "🔴"

    for violation in violations:
        bucket = scores.setdefault(
            violation.account_name,
            {"account": violation.account_name, "score": 0, "reasons": [], "icon": "🔴"},
        )
        bucket["score"] += 120
        bucket["icon"] = "🔴"
        bucket["reasons"].append(
            f"POLICY_VIOLATION — 허용 외 상품군({violation.product_category}) 광고 '{violation.keyword_text}'"
        )

    accounts = {a.name: a for a in db.scalars(select(Account))}
    for bucket in scores.values():
        account = accounts.get(bucket["account"])
        if account and account.is_growth_account:
            bucket["reasons"].append(
                "성장계정 — 광고비 증가만으로 비효율 판정하지 않고 매출/기여이익과 함께 본다 (§3)."
            )
    return sorted(scores.values(), key=lambda b: b["score"], reverse=True)[:5]


def build_agency_instructions(report: DailyReport) -> list[str]:
    """케이오마케팅 전달 권고 — 실행지시 형태로 작성한다 (§27).

    자동 집행은 하지 않는다. CEO 승인 후 사람이 전달한다 (§30).
    """
    instructions: list[str] = []

    for violation in report.policy_violations[:5]:
        instructions.append(
            f"[{violation['account']}] '{violation['keyword']}' ({violation['product_category']}) "
            f"광고 중단 — 해당 계정은 허용 상품군 외 집행 금지. 확인 후 회신 요청."
        )

    for item in report.anomalies:
        if item["type"] == "CPC_SPIKE" and item["level"] in (AlertLevel.WARNING, AlertLevel.CRITICAL):
            evidence = item["evidence"]
            instructions.append(
                f"[{item['account']}] CPC 급등 키워드 상위 20개 목록과 현재 입찰가/평균순위 회신 요청 "
                f"(CPC {evidence.get('cpc_before')}원 → {evidence.get('cpc_after')}원)."
            )
        elif item["type"] == "RANK_OVERSPEND":
            instructions.append(
                f"[{item['account']}] 평균순위 {item['evidence'].get('average_rank')}위 유지 중 — "
                "상위 2~3위 구간 테스트를 위한 입찰가 조정안 회신 요청."
            )

    for cluster in report.competition.get("top_review_clusters", [])[:3]:
        accounts = ", ".join(a["account"] for a in cluster["accounts"])
        instructions.append(
            f"[{cluster['label']}] 동일 검색의도를 {cluster['account_count']}개 계정({accounts})이 운영 중 — "
            f"재배치 검토 대상 비용 {cluster['reallocation_review_spend']:,.0f}원. "
            "계정별 실제 검색어/랜딩 확인 자료 요청."
        )

    for opportunity in report.opportunities[:5]:
        instructions.append(
            f"[신규] '{opportunity['keyword']}' 등록 검토 요청 — 근거: "
            + "; ".join(e["detail"] for e in opportunity["evidence"][:2])
            + f" (Confidence {opportunity['confidence']:.0f})."
        )

    for season in report.season[:2]:
        instructions.append(
            f"[시즌] {season['product_category']} 상승 예상 {season['expected_rise_date']} "
            f"(D-{season['days_left']}) — 사전 세팅 일정 회신 요청."
        )
    return instructions


def render_text(report: DailyReport) -> str:
    """터미널/메신저용 한국어 요약 (3분 리딩용)."""
    company = report.company
    lines: list[str] = [
        f"■ DADA 광고 데일리 리포트 ({report.as_of.isoformat()})",
        "",
        "1. 회사 전체",
        f"   어제 광고비 {company['yesterday_cost']:,.0f}원"
        + (f" (7일 평균 대비 {company['vs_7day_avg_pct']:+.0f}%)" if company["vs_7day_avg_pct"] is not None else ""),
        f"   이번달 누적 {company['month_to_date_cost']:,.0f}원 · 월말 예상 {company['projected_month_cost']:,.0f}원",
        f"   YoY: {company['yoy']['explanation']}",
    ]
    if company["yoy"]["revenue_change_pct"] is not None:
        ratio = company["yoy"]["ad_cost_ratio_pct"]
        ratio_text = f" · 광고비율 {ratio:.1f}%" if ratio else ""
        lines.append(f"   매출 YoY {company['yoy']['revenue_change_pct']:+.0f}%" + ratio_text)
    else:
        lines.append("   매출 YoY: DATA INSUFFICIENT (매출 연동 필요)")

    mix = list(company["category_mix"].items())[:5]
    if mix:
        lines.append("   상품군 비중: " + ", ".join(f"{k} {v['share']:.0f}%" for k, v in mix))

    lines += ["", "2. 우선 확인 팀"]
    if report.priority_accounts:
        for item in report.priority_accounts:
            lines.append(f"   {item['icon']} {item['account']} — {item['reasons'][0]}")
    else:
        lines.append("   특이사항 없음")

    lines += ["", "3. 이상징후"]
    if report.anomalies:
        for item in report.anomalies[:8]:
            icon = LEVEL_ICON.get(item["level"], "·")
            lines.append(f"   {icon} [{item['type']}] {item['title']} — {item['message']}")
    else:
        lines.append("   없음")

    if report.policy_violations:
        lines += ["", "   ※ POLICY_VIOLATION"]
        for violation in report.policy_violations[:5]:
            lines.append(
                f"   🔴 {violation['account']} — {violation['product_category']} '{violation['keyword']}' "
                f"({violation['cost']:,.0f}원)"
            )

    competition_summary = report.competition
    lines += [
        "",
        "4. Keyword Competition",
        f"   경쟁 허용 비용 {competition_summary.get('allowed_competition_spend', 0):,.0f}원 · "
        f"재배치 검토 비용 {competition_summary.get('reallocation_review_spend', 0):,.0f}원 "
        f"({competition_summary.get('review_share_pct', 0):.0f}%)",
    ]

    lines += ["", "5. Opportunity (Confidence 70+)"]
    if report.opportunities:
        for item in report.opportunities[:8]:
            lines.append(f"   · {item['keyword']} ({item['type']}, {item['confidence']:.0f}점) — "
                         + item["evidence"][0]["detail"])
    else:
        lines.append("   근거 기준을 통과한 신규 추천 없음 (DATA INSUFFICIENT)")

    lines += ["", "6. 케이오마케팅 전달 권고"]
    if report.agency_instructions:
        for index, instruction in enumerate(report.agency_instructions, start=1):
            lines.append(f"   {index}. {instruction}")
        lines.append("   ※ '1, 3, 5번 진행' 이라고 회신하면 전달 메시지를 자동 작성합니다.")
    else:
        lines.append("   전달할 지시 없음")

    if report.notes:
        lines += ["", "※ 참고"]
        lines += [f"   - {note}" for note in report.notes]
    return "\n".join(lines)


def agency_message(report: DailyReport, selected: list[int]) -> str:
    """'1, 3, 5번 진행' → 케이오마케팅 전달 메시지 자동 작성 (§30)."""
    chosen = [
        report.agency_instructions[i - 1]
        for i in selected
        if 1 <= i <= len(report.agency_instructions)
    ]
    if not chosen:
        return "선택된 항목이 없습니다."
    header = (
        f"안녕하세요, 다다랜드입니다.\n"
        f"{report.as_of.isoformat()} 기준 데이터 확인 결과 아래 항목 진행 요청드립니다.\n"
    )
    body = "\n".join(f"{index}. {item}" for index, item in enumerate(chosen, start=1))
    footer = (
        "\n\n각 항목 처리 후 변경 전/후 수치(노출, 클릭, CPC, 평균순위, 비용)를 함께 회신 부탁드립니다.\n"
        "확인이 어려운 항목은 사유를 알려주시면 재검토하겠습니다."
    )
    return header + body + footer


MIN_CONFIDENCE = settings.ceo_report_min_confidence
