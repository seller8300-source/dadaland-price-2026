"""§38 시스템 검증 / 데모용 합성 데이터셋.

실제 케이오 Excel 이 들어오기 전에도 시스템이 동작하는지 확인할 수 있게,
``python -m app.cli demo`` 로 적재해 대시보드와 리포트를 바로 볼 수 있다.

실제 케이오 Excel 이 아직 시스템에 없으므로, 명세(§4~§6)에 기록된
2025 vs 2026 동일기간(1~8월) 집계치와 계정별 특성을 재현하는 데이터를 만든다.

계정별 (연도별 광고비, 클릭, CTR) 은 명세 수치에 맞춘 고정값이며,
회사 합계는 명세와 정확히 일치한다:
    2025년 1~8월  광고비 64,476,115원 / 클릭 52,313 / 평균 CPC 약 1,233원
    2026년 1~8월  광고비 170,957,879원 / 클릭 93,819 / 평균 CPC 약 1,822원
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.enums import DataSource, ProductCategory, TrustStatus
from app.models import Account, Campaign, Keyword, KeywordStatDaily, SearchTerm
from app.services.classification.classifier import classify_keyword, keyword_family_root
from app.services.classification.dictionary import normalize

BASE_YEAR = 2025
COMP_YEAR = 2026
MONTHS = range(1, 9)  # 1~8월

COMPANY_TOTALS = {
    BASE_YEAR: {"cost": 64_476_115, "clicks": 52_313},
    COMP_YEAR: {"cost": 170_957_879, "clicks": 93_819},
}


@dataclass(frozen=True, slots=True)
class KeywordPlan:
    """키워드 1개의 계획.

    ``cpc_ratio`` / ``ctr_ratio`` 는 '계정 평균 대비 배수' 다. None 이면 나머지
    키워드들이 계정 평균을 정확히 맞추도록 자동 계산된다.
    """

    text: str
    click_share: float
    cpc_ratio: float | None = None
    ctr_ratio: float | None = None


@dataclass(frozen=True, slots=True)
class AccountPlan:
    name: str
    cost_2025: int
    clicks_2025: int
    ctr_2025: float
    cost_2026: int
    clicks_2026: int
    ctr_2026: float
    keywords: tuple[KeywordPlan, ...]
    average_rank_2026: float = 2.4


K = KeywordPlan

# 계정별 계획 — §6/§38 의 서술과 실측 Benchmark 를 수치로 옮긴 것.
PLANS: tuple[AccountPlan, ...] = (
    AccountPlan(  # 매출 성장계정
        "다다그룹", 15_000_000, 10_419, 4.2, 42_000_000, 17_814, 4.4,
        (
            K("이동식에어컨렌탈", 0.28, 1.30, 0.85),
            K("업소용냉장고렌탈", 0.20),
            K("행사집기렌탈", 0.16),
            K("산업용제습기임대", 0.14, 1.25, 0.85),
            K("난방기렌탈", 0.12),
            K("서울 이동식에어컨렌탈", 0.10, 0.80, 1.50),
        ),
    ),
    AccountPlan(  # 매출 성장계정 + 지역 냉방 Benchmark (CTR 17.7% / CPC 1,469원)
        "타임렌탈", 9_500_000, 8_636, 9.0, 28_946_145, 15_235, 11.0,
        (
            K("인천 이동식에어컨렌탈", 0.18, 0.773, 1.61),
            K("수원 이동식에어컨대여", 0.16, 0.773, 1.61),
            K("성남 냉풍기렌탈", 0.14, 0.773, 1.61),
            K("부천 에어컨렌탈", 0.12, 0.80, 1.55),
            K("고양 산업용선풍기렌탈", 0.12, 0.80, 1.50),
            K("이동식에어컨렌탈", 0.16, 1.70, 0.45),
            K("난방기렌탈", 0.12),
        ),
        average_rank_2026=2.1,
    ),
    AccountPlan(  # Slow-growth 최대 Volume + 이불 Primary
        "OMBC", 12_000_000, 9_600, 4.0, 28_710_000, 14_723, 3.8,
        (
            K("이불렌탈", 0.24),
            K("침구렌탈", 0.18),
            K("이동식에어컨렌탈", 0.22, 1.55, 0.95),
            K("산업용제습기렌탈", 0.14, 1.45, 0.95),
            K("행사집기대여", 0.12),
            K("크리스마스트리대여", 0.10),
        ),
        average_rank_2026=2.6,
    ),
    AccountPlan(  # CPC 상승 + CTR 하락 (고CPC 메인키워드 비중)
        "MBC렌탈", 6_800_000, 5_231, 5.0, 15_500_000, 8_223, 3.9,
        (
            K("이동식에어컨", 0.26, 1.60, 0.90),
            K("코끼리에어컨", 0.20, 1.65, 0.90),
            K("업소용냉장고", 0.18),
            K("이동식에어컨렌탈", 0.16, 1.35, 0.95),
            K("난방기렌탈", 0.12),
            K("행사집기렌탈", 0.08),
        ),
        average_rank_2026=1.9,
    ),
    AccountPlan(  # Efficiency Warning 우선계정 (CPC +153%, CTR -65%)
        "마니", 5_200_000, 4_727, 5.5, 13_200_000, 4_743, 1.925,
        (
            K("코끼리에어컨", 0.30, 1.15),
            K("이동식에어컨", 0.24, 1.15),
            K("산업용제습기", 0.20, 1.10),
            K("냉풍기렌탈", 0.14),
            K("난방기임대", 0.12),
        ),
        average_rank_2026=1.6,
    ),
    AccountPlan(  # 클릭 확장형 + Excel 비용 복사 오류 (아래에서 주입)
        "으라차차", 5_000_000, 4_000, 4.5, 12_400_000, 9_802, 4.4,
        (
            K("업소용냉장고", 0.24),
            K("행사집기렌탈", 0.22),
            K("축제 의자대여", 0.18),
            K("이동식에어컨", 0.12, 2.30, 0.80),
            K("난방기렌탈", 0.14),
            K("쇼케이스렌탈", 0.10),
        ),
    ),
    AccountPlan(  # 냉방 Efficiency Benchmark Candidate (CPC 2,427 / CTR 6.89) + 1위 고정
        "다있지", 4_000_000, 3_478, 6.0, 10_300_000, 5_200, 6.5,
        (
            K("이동식에어컨렌탈", 0.34, 1.225, 1.06),
            K("산업용제습기렌탈", 0.26, 1.225, 1.06),
            K("냉풍기대여", 0.14, 1.225, 1.06),
            K("업소용냉장고렌탈", 0.16),
            K("행사집기렌탈", 0.10),
        ),
        average_rank_2026=1.2,
    ),
    AccountPlan(  # 확대형 (비용 증가 < 클릭 증가, CPC 하락)
        "킴샵", 3_200_000, 2_286, 5.0, 9_800_000, 8_522, 5.5,
        (
            K("행사집기렌탈", 0.26),
            K("축제 천막대여", 0.20),
            K("박람회 부스렌탈", 0.18),
            K("행사용 냉장고렌탈", 0.16),
            K("돔텐트대여", 0.14),
            K("이동식에어컨", 0.06, 2.60, 0.90),
        ),
        average_rank_2026=3.1,
    ),
    AccountPlan(  # 상대적 저CPC — 용도 기반 고의도 롱테일
        "빌리마켓", 2_300_000, 2_706, 7.0, 7_100_000, 7_889, 7.5,
        (
            K("단기 행사집기렌탈", 0.24),
            K("공사장 이동식에어컨대여", 0.20),
            K("창고 산업용선풍기렌탈", 0.18),
            K("야외 천막대여", 0.16),
            K("행사장 냉장고렌탈", 0.12),
            K("촬영장 발전기렌탈", 0.10),
        ),
        average_rank_2026=3.4,
    ),
    AccountPlan(  # 물류 ONLY — 2026 난방기 광고가 POLICY_VIOLATION
        "현대도크", 1_476_115, 1_230, 4.0, 3_001_734, 1_668, 4.2,
        (
            K("이동식도크임대", 0.30),
            K("컨테이너도크렌탈", 0.22),
            K("롤테이너렌탈", 0.18),
            K("대차렌탈", 0.14),
            K("스태커임대", 0.11),
            K("난방기렌탈", 0.05),
        ),
        average_rank_2026=2.8,
    ),
)


def _resolve_ratios(keywords: tuple[KeywordPlan, ...], attribute: str, harmonic: bool) -> dict[str, float]:
    """None 인 키워드의 배수를 계산해 계정 평균이 정확히 맞도록 만든다.

    CPC 는 산술 제약(Σ share·w = 1), CTR 은 조화 제약(Σ share/v = 1) 을 쓴다.
    """
    fixed = {k.text: getattr(k, attribute) for k in keywords if getattr(k, attribute) is not None}
    free = [k for k in keywords if getattr(k, attribute) is None]
    if harmonic:
        used = sum(k.click_share / fixed[k.text] for k in keywords if k.text in fixed)
    else:
        used = sum(k.click_share * fixed[k.text] for k in keywords if k.text in fixed)
    residual = 1.0 - used
    free_share = sum(k.click_share for k in free)
    ratios = dict(fixed)
    if free:
        if residual <= 0:
            raise ValueError(f"{attribute} 배수 합이 1을 넘습니다 — 계정 계획을 조정하세요.")
        value = (free_share / residual) if harmonic else (residual / free_share)
        for keyword in free:
            ratios[keyword.text] = value
    return ratios


# 냉방 성수기 가중치 (§20) — 6~8월에 수요가 몰린다.
COOLING_MONTH_WEIGHT = {1: 0.4, 2: 0.4, 3: 0.6, 4: 0.9, 5: 1.4, 6: 2.0, 7: 2.4, 8: 2.1}
FLAT_MONTH_WEIGHT = {month: 1.0 for month in MONTHS}

# 다있지 냉방 Benchmark 실측치 (§6)
DAITZI_COOLING_CPC = 2_427.0
DAITZI_COOLING_CTR = 6.89


def _month_weight(category: str, month: int) -> float:
    if category == ProductCategory.COOLING:
        return COOLING_MONTH_WEIGHT[month]
    if category == ProductCategory.HEATING:
        return {1: 1.8, 2: 1.4, 3: 0.8, 4: 0.4, 5: 0.2, 6: 0.2, 7: 0.2, 8: 0.3}[month]
    if category == ProductCategory.EVENT:
        return {1: 0.6, 2: 0.8, 3: 1.4, 4: 1.6, 5: 1.5, 6: 1.0, 7: 0.8, 8: 1.0}[month]
    return FLAT_MONTH_WEIGHT[month]


def _largest_remainder(total: int, weights: list[float]) -> list[int]:
    """가중치대로 정수 배분하되 합이 정확히 total 이 되게 한다."""
    if total <= 0 or not weights:
        return [0] * len(weights)
    weight_sum = sum(weights) or 1.0
    raw = [total * w / weight_sum for w in weights]
    floors = [int(x) for x in raw]
    remainder = total - sum(floors)
    order = sorted(range(len(raw)), key=lambda i: raw[i] - floors[i], reverse=True)
    for index in order[:remainder]:
        floors[index] += 1
    return floors


def _dates_for(year: int, month: int, daily: bool) -> list[date]:
    days = calendar.monthrange(year, month)[1]
    if daily:
        return [date(year, month, day) for day in range(1, days + 1)]
    return [date(year, month, day) for day in (7, 14, 21, 28) if day <= days]


def _upsert_keyword(db: Session, account: Account, campaign: Campaign, text: str) -> Keyword:
    keyword = (
        db.query(Keyword)
        .filter(Keyword.account_id == account.id, Keyword.text == text)
        .one_or_none()
    )
    if keyword is None:
        keyword = Keyword(
            account_id=account.id,
            campaign_id=campaign.id,
            text=text,
            normalized_text=normalize(text),
            family_root=keyword_family_root(text),
            is_main_keyword=normalize(text) in {normalize(k) for k in
                ("코끼리에어컨", "이동식에어컨", "업소용냉장고", "산업용제습기")},
        )
        db.add(keyword)
        db.flush()
    return keyword


def _campaign_for(db: Session, account: Account, name: str) -> Campaign:
    campaign = (
        db.query(Campaign)
        .filter(Campaign.account_id == account.id, Campaign.name == name)
        .one_or_none()
    )
    if campaign is None:
        campaign = Campaign(account_id=account.id, name=name)
        db.add(campaign)
        db.flush()
    return campaign


def generate(db: Session, daily_tail_month: int = 8) -> None:
    """2025/2026 1~8월 성과 데이터를 만든다.

    ``daily_tail_month`` 월은 일자별로, 나머지는 주 단위(7/14/21/28일)로 적재한다.
    비용은 클릭에 비례해 배분하므로 '클릭 0 인데 비용 발생' 같은 불가능한 행은 생기지 않는다.
    """
    for plan in PLANS:
        account = db.query(Account).filter(Account.name == plan.name).one()
        # 캠페인명은 일부러 상품과 어긋나게 둔다 — 캠페인명이 Source of Truth 가
        # 아님을 시스템이 스스로 증명해야 한다 (§9 캠페인 라벨 오류).
        campaign = _campaign_for(db, account, f"{plan.name}_냉방_캠페인")
        cpc_ratios = _resolve_ratios(plan.keywords, "cpc_ratio", harmonic=False)
        ctr_ratios = _resolve_ratios(plan.keywords, "ctr_ratio", harmonic=True)

        for year, cost_total, clicks_total, account_ctr in (
            (BASE_YEAR, plan.cost_2025, plan.clicks_2025, plan.ctr_2025),
            (COMP_YEAR, plan.cost_2026, plan.clicks_2026, plan.ctr_2026),
        ):
            slots: list[tuple[KeywordPlan, str, date, float]] = []
            for keyword_plan in plan.keywords:
                category = classify_keyword(keyword_plan.text).category
                for month in MONTHS:
                    daily = month == daily_tail_month and year == COMP_YEAR
                    days = _dates_for(year, month, daily)
                    weight = keyword_plan.click_share * _month_weight(category, month) / len(days)
                    for day in days:
                        slots.append((keyword_plan, category, day, weight))

            clicks_alloc = _largest_remainder(clicks_total, [slot[3] for slot in slots])
            cost_weights = [
                clicks * cpc_ratios[slot[0].text] for slot, clicks in zip(slots, clicks_alloc, strict=True)
            ]
            cost_alloc = _largest_remainder(cost_total, cost_weights)

            for (keyword_plan, category, day, _), clicks, cost in zip(
                slots, clicks_alloc, cost_alloc, strict=True
            ):
                if clicks == 0:
                    continue
                keyword = _upsert_keyword(db, account, campaign, keyword_plan.text)
                keyword_ctr = account_ctr * ctr_ratios[keyword_plan.text]
                impressions = max(int(round(clicks / (keyword_ctr / 100))), clicks)
                classification = classify_keyword(keyword_plan.text)
                db.add(
                    KeywordStatDaily(
                        account_id=account.id,
                        campaign_id=campaign.id,
                        keyword_id=keyword.id,
                        stat_date=day,
                        keyword_text=keyword_plan.text,
                        device="ALL",
                        impressions=impressions,
                        clicks=clicks,
                        cost=float(cost),
                        average_rank=plan.average_rank_2026 if year == COMP_YEAR else 2.5,
                        conversions=0,
                        product_category=category,
                        classification_confidence=classification.confidence,
                        source=DataSource.EXCEL_KAYO,
                        trust_status=TrustStatus.UNVERIFIED,
                        raw_row={"키워드": keyword_plan.text, "총비용": cost, "클릭수": clicks},
                    )
                )
    db.commit()


def inject_cost_copy_defect(
    db: Session,
    source_name: str = "MBC렌탈",
    target_name: str = "으라차차",
    keywords: tuple[str, ...] = ("난방기렌탈", "행사집기렌탈"),
) -> int:
    """§9 — 으라차차 키워드 비용값이 MBC렌탈과 동일 패턴으로 복사된 문제를 재현한다.

    실제 Excel 에서 확인된 형태 그대로, 특정 키워드의 '비용' 열만 통째로 복사한다.
    """
    source = db.query(Account).filter(Account.name == source_name).one()
    target = db.query(Account).filter(Account.name == target_name).one()

    source_rows = (
        db.query(KeywordStatDaily)
        .filter(
            KeywordStatDaily.account_id == source.id,
            KeywordStatDaily.keyword_text.in_(keywords),
            KeywordStatDaily.stat_date >= date(COMP_YEAR, 1, 1),
        )
        .all()
    )
    copied = 0
    for row in source_rows:
        target_row = (
            db.query(KeywordStatDaily)
            .filter(
                KeywordStatDaily.account_id == target.id,
                KeywordStatDaily.keyword_text == row.keyword_text,
                KeywordStatDaily.stat_date == row.stat_date,
            )
            .one_or_none()
        )
        if target_row is None:
            continue
        target_row.cost = row.cost  # 비용값만 복사된 전형적 오류
        copied += 1
    db.commit()
    return copied


def add_search_terms(db: Session, account_name: str = "타임렌탈") -> None:
    """실제 검색어 데이터 (Opportunity 엔진 근거)."""
    account = db.query(Account).filter(Account.name == account_name).one()
    samples = [
        ("킨텍스 행사집기렌탈", 9, 4, 3_600),
        ("코엑스 냉장고렌탈", 7, 5, 4_200),
        ("송도 냉동고렌탈", 6, 3, 2_400),
        ("삼성동 냉장고렌탈", 5, 3, 2_700),
        ("일산 이동식에어컨대여", 8, 6, 5_400),
    ]
    start = date(COMP_YEAR, 7, 1)
    for text, days, clicks_per_day, cost_per_day in samples:
        for offset in range(days):
            db.add(
                SearchTerm(
                    account_id=account.id,
                    stat_date=start + timedelta(days=offset),
                    text=text,
                    normalized_text=normalize(text),
                    impressions=clicks_per_day * 12,
                    clicks=clicks_per_day,
                    cost=float(cost_per_day),
                    conversions=1 if offset == 0 else 0,
                    source=DataSource.EXCEL_KAYO,
                    trust_status=TrustStatus.UNVERIFIED,
                )
            )
    db.commit()


def period(year: int) -> tuple[date, date]:
    """해당 연도 1~8월 구간."""
    return date(year, 1, 1), date(year, 8, 31)
