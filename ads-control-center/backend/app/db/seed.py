"""초기 시드 데이터 (§2 계정, §10 상품군, §6/§19 운영규칙).

계정과 규칙은 모두 DB 행이다 — 계정이 추가돼도 코드는 바뀌지 않는다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import CompetitionPolicy, ProductCategory
from app.models import Account, BusinessRule, CompetitionCluster, ProductCategoryRow

# (name, team, growth_account, efficiency_priority, allowed_categories, note)
SEED_ACCOUNTS: list[tuple[str, str, bool, bool, list[str] | None, str]] = [
    ("다다그룹", "다다", True, False, None, "매출 성장계정. 광고비 증가율보다 매출/기여이익 증가율을 우선 평가 (§6)."),
    ("타임렌탈", "타임", True, False, None, "매출 성장계정. 지역 냉방 캠페인은 지역키워드 Benchmark 사례 (§6)."),
    ("OMBC", "OMBC", False, True, None,
     "Slow-growth 그룹 최대 Volume 계정 + 이불 Primary. 냉방 효율 Benchmark 로 단정하지 않는다 (§6)."),
    ("MBC렌탈", "MBC", False, True, None, "CPC 상승 + CTR 하락. 메인/일반 키워드 비중과 고CPC 검색어 점검 (§6)."),
    ("마니", "마니", False, True, None, "Efficiency Warning 우선계정. CPC 급등 + CTR 급락 (§6)."),
    ("으라차차", "으라차차", False, True, None, "클릭 확장형. Excel 키워드 비용 데이터 오류로 상세판단 보류 (§6, §9)."),
    ("다있지", "다있지", False, True, None,
     "냉방 Efficiency Benchmark Candidate. 전환 데이터 확보 전 우승계정으로 고정하지 않는다 (§6)."),
    ("킴샵", "킴샵", False, True, None,
     "비용 증가보다 클릭 증가가 큰 확대형. 행사/축제 저CPC 고의도 키워드 유지 (§6)."),
    ("빌리마켓", "빌리마켓", False, True, None,
     "저CPC 계정. 저비용 고의도 키워드 발굴 Benchmark 후보. 일괄삭감 대상 아님 (§6)."),
    (
        "현대도크",
        "현대도크",
        False,
        True,
        [ProductCategory.LOGISTICS],
        "물류장비 ONLY. 물류 외 광고 발생 시 즉시 POLICY_VIOLATION (§6).",
    ),
]

# (code, name, seasonal, peak_months, sort)
SEED_CATEGORIES: list[tuple[str, str, bool, list[int] | None, int]] = [
    (ProductCategory.COOLING, "냉방", True, [5, 6, 7, 8], 10),
    (ProductCategory.HEATING, "난방", True, [11, 12, 1, 2], 20),
    (ProductCategory.LOGISTICS, "물류/도크", False, None, 30),
    (ProductCategory.EVENT, "행사/축제", True, [3, 4, 5, 9, 10, 11], 40),
    (ProductCategory.KITCHEN, "주방/냉장", False, None, 50),
    (ProductCategory.BEDDING, "침구/이불", True, [10, 11, 12, 1], 60),
    (ProductCategory.XMAS_TREE, "크리스마스트리", True, [11, 12], 70),
    (ProductCategory.OTHER, "기타", False, None, 80),
    (ProductCategory.UNCLASSIFIED, "미분류", False, None, 99),
]


def _get_account(db: Session, name: str) -> Account | None:
    return db.scalar(select(Account).where(Account.name == name))


def seed_accounts(db: Session) -> list[Account]:
    created: list[Account] = []
    for name, team, growth, efficiency, allowed, note in SEED_ACCOUNTS:
        account = _get_account(db, name)
        if account is None:
            account = Account(name=name, team=team)
            db.add(account)
            created.append(account)
        account.is_growth_account = growth
        account.efficiency_priority = efficiency
        account.allowed_categories = allowed
        account.note = note
    db.flush()
    return created


def seed_categories(db: Session) -> None:
    for code, name, seasonal, peak, order in SEED_CATEGORIES:
        row = db.scalar(select(ProductCategoryRow).where(ProductCategoryRow.code == code))
        if row is None:
            row = ProductCategoryRow(code=code)
            db.add(row)
        row.name = name
        row.is_seasonal = seasonal
        row.peak_months = peak
        row.sort_order = order
    db.flush()


def seed_business_rules(db: Session) -> None:
    """§6, §19, §26 의 운영규칙을 DB 로 옮긴다."""
    hyundai = _get_account(db, "현대도크")
    ombc = _get_account(db, "OMBC")

    rules: list[dict] = [
        {
            "code": "HYUNDAI_DOCK_LOGISTICS_ONLY",
            "rule_type": "ALLOWED_CATEGORY",
            "account_id": hyundai.id if hyundai else None,
            "product_category": None,
            "params": {"allowed": [ProductCategory.LOGISTICS]},
            "description": "현대도크는 물류장비 ONLY. 그 외 상품군 광고가 발생하면 POLICY_VIOLATION (§6).",
        },
        {
            "code": "BEDDING_PRIMARY_OMBC",
            "rule_type": "PRIMARY_ACCOUNT",
            "account_id": ombc.id if ombc else None,
            "product_category": ProductCategory.BEDDING,
            "params": {
                "policy": CompetitionPolicy.PRIMARY_PLUS_CHALLENGER,
                "max_accounts_off_season": 1,
                "max_accounts_in_season": 3,
            },
            "description": "이불/침구는 OMBC Primary. 성수기에만 1~2개 팀 Challenger 허용 (§19).",
        },
        {
            "code": "COOLING_SEASON_COMPETITION",
            "rule_type": "COMPETITION_POLICY",
            "account_id": None,
            "product_category": ProductCategory.COOLING,
            "params": {
                "policy": CompetitionPolicy.ALLOWED,
                "max_accounts_off_season": 2,
                "max_accounts_in_season": 5,
            },
            "description": "냉방 성수기에는 5개 팀 동일 키워드 운영도 허용 가능 (§19).",
        },
        {
            "code": "DEFAULT_CONTRIBUTION_MARGIN",
            "rule_type": "MARGIN",
            "account_id": None,
            "product_category": None,
            "params": {"contribution_margin_rate": 0.30, "target_ad_cost_ratios": [0.20, 0.15, 0.10]},
            "description": "기여마진율 기본 30%. 광고비율 시나리오 20/15/10% (§26).",
        },
        {
            "code": "GROWTH_ACCOUNT_EVALUATION",
            "rule_type": "THRESHOLD",
            "account_id": None,
            "product_category": None,
            "params": {"growth_accounts": ["다다그룹", "타임렌탈"], "evaluate_by": "revenue_growth_vs_cost_growth"},
            "description": "성장계정은 광고비 증가만으로 비효율 판정 금지 (§3).",
        },
        {
            "code": "CEO_REPORT_MIN_CONFIDENCE",
            "rule_type": "THRESHOLD",
            "account_id": None,
            "product_category": None,
            "params": {"min_confidence": 70},
            "description": "Confidence 70점 미만 추천은 CEO 보고서에서 제외 (§17).",
        },
        {
            "code": "NAVER_API_READ_ONLY",
            "rule_type": "THRESHOLD",
            "account_id": None,
            "product_category": None,
            "params": {"read_only": True},
            "description": "NAVER API 는 READ ONLY. AI 자동 입찰/광고 변경 금지 (§30).",
        },
    ]

    for rule in rules:
        existing = db.scalar(select(BusinessRule).where(BusinessRule.code == rule["code"]))
        if existing is None:
            existing = BusinessRule(code=rule["code"])
            db.add(existing)
        existing.rule_type = rule["rule_type"]
        existing.account_id = rule["account_id"]
        existing.product_category = rule["product_category"]
        existing.params = rule["params"]
        existing.description = rule["description"]
        existing.is_active = True
    db.flush()


def seed_competition_clusters(db: Session) -> None:
    """상품군 기본 경쟁정책 (§18–19). Intent Cluster 는 실적 데이터로 계속 확장된다."""
    ombc = _get_account(db, "OMBC")
    defaults = [
        (ProductCategory.COOLING, CompetitionPolicy.ALLOWED, 2, 5, None),
        (ProductCategory.HEATING, CompetitionPolicy.ALLOWED, 2, 4, None),
        (ProductCategory.BEDDING, CompetitionPolicy.PRIMARY_PLUS_CHALLENGER, 1, 3, ombc.id if ombc else None),
        (ProductCategory.EVENT, CompetitionPolicy.ALLOWED, 3, 5, None),
        (ProductCategory.LOGISTICS, CompetitionPolicy.ALLOWED, 2, 3, None),
        (ProductCategory.KITCHEN, CompetitionPolicy.ALLOWED, 2, 4, None),
        (ProductCategory.XMAS_TREE, CompetitionPolicy.ALLOWED, 1, 3, None),
    ]
    for category, policy, off_max, in_max, primary_id in defaults:
        key = f"category:{category}"
        row = db.scalar(select(CompetitionCluster).where(CompetitionCluster.cluster_key == key))
        if row is None:
            row = CompetitionCluster(cluster_key=key)
            db.add(row)
        row.label = f"{category} 기본 경쟁정책"
        row.product_category = category
        row.intent_type = "CATEGORY"
        row.policy = policy
        row.max_accounts_off_season = off_max
        row.max_accounts_in_season = in_max
        row.primary_account_id = primary_id
    db.flush()


def seed_all(db: Session) -> None:
    seed_accounts(db)
    seed_categories(db)
    seed_business_rules(db)
    seed_competition_clusters(db)
    db.commit()
