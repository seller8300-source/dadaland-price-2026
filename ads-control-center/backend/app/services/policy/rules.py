"""회사 운영규칙 검사 (§6).

현대도크는 물류장비 ONLY 다. 물류 외 광고가 발생하면 즉시 POLICY_VIOLATION.
(과거 현대도크 계정에서 난방기 광고가 발생한 사례가 있다.)
규칙 자체는 business_rules 테이블에서 읽으므로 계정이 늘어도 코드는 그대로다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.enums import AlertLevel, AlertType, ProductCategory
from app.models import Account, Alert, BusinessRule, KeywordStatDaily
from app.services.quality.validator import trusted_stats_filter

# 미분류는 위반으로 단정하지 않는다 — 분류 실패를 정책위반으로 오인하면 안 된다 (§11).
NEUTRAL_CATEGORIES = {ProductCategory.UNCLASSIFIED, ProductCategory.OTHER}


@dataclass(slots=True)
class PolicyViolation:
    account_id: int
    account_name: str
    product_category: str
    keyword_text: str
    cost: float
    clicks: int
    stat_date: date
    rule_code: str

    def as_dict(self) -> dict:
        return {
            "account": self.account_name,
            "product_category": self.product_category,
            "keyword": self.keyword_text,
            "cost": round(self.cost, 1),
            "clicks": self.clicks,
            "date": self.stat_date.isoformat(),
            "rule_code": self.rule_code,
        }


def allowed_categories_for(db: Session, account: Account) -> list[str] | None:
    """계정에 허용된 상품군. None 이면 제한 없음."""
    if account.allowed_categories:
        return list(account.allowed_categories)
    rule = db.scalar(
        select(BusinessRule).where(
            BusinessRule.rule_type == "ALLOWED_CATEGORY",
            BusinessRule.account_id == account.id,
            BusinessRule.is_active.is_(True),
        )
    )
    if rule and rule.params:
        allowed = rule.params.get("allowed")
        if allowed:
            return list(allowed)
    return None


def detect_violations(db: Session, start: date, end: date) -> list[PolicyViolation]:
    """구간 내 허용 상품군 위반 광고를 찾는다."""
    violations: list[PolicyViolation] = []
    for account in db.scalars(select(Account).where(Account.is_active.is_(True))):
        allowed = allowed_categories_for(db, account)
        if not allowed:
            continue
        rule_code = "ALLOWED_CATEGORY"
        rule = db.scalar(
            select(BusinessRule).where(
                BusinessRule.rule_type == "ALLOWED_CATEGORY",
                BusinessRule.account_id == account.id,
            )
        )
        if rule:
            rule_code = rule.code

        rows = db.execute(
            select(
                KeywordStatDaily.product_category,
                KeywordStatDaily.keyword_text,
                func.sum(KeywordStatDaily.cost),
                func.sum(KeywordStatDaily.clicks),
                func.max(KeywordStatDaily.stat_date),
            )
            .where(
                and_(
                    KeywordStatDaily.account_id == account.id,
                    KeywordStatDaily.stat_date >= start,
                    KeywordStatDaily.stat_date <= end,
                    trusted_stats_filter(),
                )
            )
            .group_by(KeywordStatDaily.product_category, KeywordStatDaily.keyword_text)
        ).all()

        for category, keyword_text, cost, clicks, last_date in rows:
            if category in allowed or category in NEUTRAL_CATEGORIES or not category:
                continue
            violations.append(
                PolicyViolation(
                    account_id=account.id,
                    account_name=account.name,
                    product_category=category,
                    keyword_text=keyword_text or "",
                    cost=float(cost or 0.0),
                    clicks=int(clicks or 0),
                    stat_date=last_date or end,
                    rule_code=rule_code,
                )
            )
    return sorted(violations, key=lambda v: v.cost, reverse=True)


def record_violation_alerts(db: Session, violations: list[PolicyViolation], as_of: date) -> list[Alert]:
    """POLICY_VIOLATION 을 계정 단위 알림으로 적재한다."""
    by_account: dict[int, list[PolicyViolation]] = {}
    for violation in violations:
        by_account.setdefault(violation.account_id, []).append(violation)

    alerts: list[Alert] = []
    for account_id, items in by_account.items():
        total_cost = sum(v.cost for v in items)
        categories = sorted({v.product_category for v in items})
        existing = db.scalar(
            select(Alert).where(
                Alert.account_id == account_id,
                Alert.as_of_date == as_of,
                Alert.alert_type == AlertType.POLICY_VIOLATION,
            )
        )
        alert = existing or Alert(
            account_id=account_id, as_of_date=as_of, alert_type=AlertType.POLICY_VIOLATION
        )
        alert.level = AlertLevel.CRITICAL
        alert.title = f"POLICY_VIOLATION — {items[0].account_name} 허용 외 상품군 광고 {len(items)}건"
        alert.message = (
            f"{items[0].account_name} 계정에서 허용되지 않은 상품군({', '.join(categories)}) "
            f"광고가 확인되었습니다. 해당 비용 {total_cost:,.0f}원. 즉시 중단 검토가 필요합니다."
        )
        alert.evidence = {
            "rule_code": items[0].rule_code,
            "violating_categories": categories,
            "total_cost": round(total_cost, 1),
            "samples": [v.as_dict() for v in items[:20]],
        }
        if existing is None:
            db.add(alert)
        alerts.append(alert)
    db.flush()
    return alerts
