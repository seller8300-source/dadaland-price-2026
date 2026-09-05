"""STEP 2 — Data Quality Validator.

적재된 UNVERIFIED 데이터를 검증해 TRUSTED / WARNING / REJECTED 로 확정한다 (§8).
Excel 에 있다는 이유만으로 분석에 쓰지 않는다.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import TrustStatus
from app.models import (
    Account,
    Campaign,
    DataQualityWarning,
    HistoricalImport,
    KeywordStatDaily,
)
from app.services.classification.classifier import classify_keyword
from app.services.quality.rules import (
    BLOCKING,
    NON_BLOCKING,
    RULE_DESCRIPTIONS,
    Finding,
    has_template_string,
    jaccard,
)

# 계정 간 행 중복 판단 임계치 — 시트 지문의 40% 이상이 겹치면 복사로 본다.
ROW_DUPLICATION_THRESHOLD = 0.40
# 키워드별 비용 시퀀스 일치 개수 임계치 (으라차차 ↔ MBC렌탈 패턴)
COST_PATTERN_MIN_MATCHES = 10
# 서로 다른 금액이 이만큼 반복 일치해야 '복사' 로 본다 (우연 방지)
COST_PATTERN_MIN_DISTINCT_VALUES = 5
CTR_TOLERANCE = 0.5   # %p
CPC_TOLERANCE = 0.05  # 5%


@dataclass(slots=True)
class ValidationReport:
    findings: list[Finding] = field(default_factory=list)
    trusted_rows: int = 0
    warning_rows: int = 0
    rejected_rows: int = 0

    @property
    def blocking_findings(self) -> list[Finding]:
        return [f for f in self.findings if f.blocks_analysis]

    def summary(self) -> dict:
        by_rule: dict[str, int] = defaultdict(int)
        for finding in self.findings:
            by_rule[finding.rule_code] += 1
        return {
            "findings": len(self.findings),
            "blocking": len(self.blocking_findings),
            "by_rule": dict(by_rule),
            "trusted_rows": self.trusted_rows,
            "warning_rows": self.warning_rows,
            "rejected_rows": self.rejected_rows,
        }


def _row_level_findings(stat: KeywordStatDaily) -> list[Finding]:
    findings: list[Finding] = []
    scope = f"keyword_stats_daily#{stat.id}"

    if stat.clicks < 0 or stat.impressions < 0 or stat.cost < 0:
        findings.append(
            Finding("NEGATIVE_METRIC", BLOCKING, scope, RULE_DESCRIPTIONS["NEGATIVE_METRIC"],
                    {"clicks": stat.clicks, "impressions": stat.impressions, "cost": stat.cost})
        )
    if stat.impressions and stat.clicks > stat.impressions:
        findings.append(
            Finding("CLICKS_EXCEED_IMPRESSIONS", BLOCKING, scope,
                    RULE_DESCRIPTIONS["CLICKS_EXCEED_IMPRESSIONS"],
                    {"clicks": stat.clicks, "impressions": stat.impressions})
        )
    if stat.clicks == 0 and stat.cost > 0:
        findings.append(
            Finding("COST_WITHOUT_CLICKS", BLOCKING, scope,
                    RULE_DESCRIPTIONS["COST_WITHOUT_CLICKS"], {"cost": stat.cost})
        )

    raw = stat.raw_row or {}
    for column, value in raw.items():
        if has_template_string(value):
            findings.append(
                Finding("TEMPLATE_STRING_IN_VALUE", BLOCKING, scope,
                        f"{RULE_DESCRIPTIONS['TEMPLATE_STRING_IN_VALUE']} — 컬럼 '{column}'",
                        {"column": column, "value": str(value)[:120]})
            )
            break

    # 기재된 CTR/CPC 와 실제 계산값의 불일치 (가공 과정 오류 탐지)
    for key, value in raw.items():
        label = str(key)
        if "CTR" in label.upper() or "클릭률" in label:
            try:
                stated = float(str(value).replace("%", "").replace(",", ""))
            except (TypeError, ValueError):
                continue
            if stat.impressions:
                actual = stat.clicks / stat.impressions * 100
                if abs(actual - stated) > CTR_TOLERANCE:
                    findings.append(
                        Finding("CTR_INCONSISTENT", NON_BLOCKING, scope,
                                RULE_DESCRIPTIONS["CTR_INCONSISTENT"],
                                {"stated": stated, "actual": round(actual, 2)})
                    )
        elif "CPC" in label.upper() or "클릭비용" in label or "클릭단가" in label:
            try:
                stated = float(str(value).replace(",", "").replace("원", ""))
            except (TypeError, ValueError):
                continue
            if stat.clicks and stated > 0:
                actual = stat.cost / stat.clicks
                if abs(actual - stated) > max(CPC_TOLERANCE * stated, 1.0):
                    findings.append(
                        Finding("CPC_INCONSISTENT", NON_BLOCKING, scope,
                                RULE_DESCRIPTIONS["CPC_INCONSISTENT"],
                                {"stated": stated, "actual": round(actual, 2)})
                    )
    return findings


def _cross_account_row_duplication(db: Session) -> list[Finding]:
    """여러 계정 시트에 동일 행이 복사된 정황 (§9 전환수 / 쇼핑검색 상세)."""
    findings: list[Finding] = []
    imports = db.scalars(select(HistoricalImport)).all()
    fingerprint_sets: list[tuple[HistoricalImport, set[str]]] = []
    for record in imports:
        summary = record.summary or {}
        prints = set(summary.get("row_fingerprints") or [])
        if len(prints) >= 5:
            fingerprint_sets.append((record, prints))

    for i in range(len(fingerprint_sets)):
        record_a, prints_a = fingerprint_sets[i]
        for j in range(i + 1, len(fingerprint_sets)):
            record_b, prints_b = fingerprint_sets[j]
            if record_a.account_id == record_b.account_id or record_a.account_id is None:
                continue
            overlap = jaccard(prints_a, prints_b)
            if overlap >= ROW_DUPLICATION_THRESHOLD:
                sheet = (record_a.sheet_name or "").strip()
                is_conversion_sheet = "전환" in sheet
                code = "CONVERSION_SHEET_UNUSABLE" if is_conversion_sheet else "CROSS_ACCOUNT_ROW_DUPLICATION"
                findings.append(
                    Finding(
                        code,
                        BLOCKING,
                        f"sheet:{sheet or record_a.file_name}",
                        f"{RULE_DESCRIPTIONS[code]} — '{record_a.file_name}/{sheet}' 와 "
                        f"'{record_b.file_name}/{record_b.sheet_name}' 행 일치율 {overlap:.0%}",
                        {"overlap": round(overlap, 3),
                         "left": f"{record_a.file_name}/{record_a.sheet_name}",
                         "right": f"{record_b.file_name}/{record_b.sheet_name}"},
                        account_ids=[x for x in (record_a.account_id, record_b.account_id) if x],
                        import_ids=[record_a.id, record_b.id],
                    )
                )
    return findings


def _cost_pattern_copy(db: Session) -> list[Finding]:
    """계정 간 '키워드 → 비용' 값이 통째로 복사된 경우 (§9 으라차차 ↔ MBC렌탈).

    계정 전체가 아니라 **키워드 단위** 로 판정한다. 어느 쪽이 원본인지 알 수 없으므로
    해당 키워드 행은 양쪽 모두 분석에서 제외하고, 두 계정에 경고를 남긴다.
    """
    rows = db.execute(
        select(
            KeywordStatDaily.account_id,
            KeywordStatDaily.keyword_text,
            KeywordStatDaily.stat_date,
            KeywordStatDaily.cost,
        )
    ).all()

    by_keyword: dict[str, dict[int, dict[object, float]]] = defaultdict(lambda: defaultdict(dict))
    for account_id, keyword_text, stat_date, cost in rows:
        if account_id and keyword_text:
            by_keyword[keyword_text][account_id][stat_date] = round(float(cost or 0.0), 2)

    accounts = {a.id: a.name for a in db.scalars(select(Account)).all()}
    findings: list[Finding] = []

    for keyword_text, per_account in by_keyword.items():
        account_ids = sorted(per_account)
        for i in range(len(account_ids)):
            for j in range(i + 1, len(account_ids)):
                left, right = per_account[account_ids[i]], per_account[account_ids[j]]
                shared = set(left) & set(right)
                if len(shared) < COST_PATTERN_MIN_MATCHES:
                    continue
                identical = [d for d in shared if left[d] == right[d] and left[d] > 0]
                distinct_values = {left[d] for d in identical}
                # 일별 비용이 원 단위까지 똑같은 날이 10일 이상, 그것도 서로 다른 금액으로
                # 반복된다면 우연이 아니라 복사다.
                if (
                    len(identical) < COST_PATTERN_MIN_MATCHES
                    or len(distinct_values) < COST_PATTERN_MIN_DISTINCT_VALUES
                ):
                    continue
                findings.append(
                    Finding(
                        "COST_PATTERN_COPIED_BETWEEN_ACCOUNTS",
                        BLOCKING,
                        f"keyword_stats_daily.cost:{keyword_text}",
                        f"{RULE_DESCRIPTIONS['COST_PATTERN_COPIED_BETWEEN_ACCOUNTS']} — "
                        f"'{keyword_text}' 비용이 {accounts.get(account_ids[i])} ↔ "
                        f"{accounts.get(account_ids[j])} 간 {len(identical)}/{len(shared)}일 동일",
                        {
                            "keyword": keyword_text,
                            "identical_days": len(identical),
                            "shared_days": len(shared),
                            "rejected_keys": [
                                [account_ids[i], keyword_text, str(d)] for d in identical
                            ]
                            + [[account_ids[j], keyword_text, str(d)] for d in identical],
                        },
                        account_ids=[account_ids[i], account_ids[j]],
                    )
                )
    return findings


def _campaign_label_mismatch(db: Session) -> list[Finding]:
    """캠페인 라벨과 키워드 실제 상품군의 불일치 (§9).

    상품분류에 캠페인명을 Source of Truth 로 쓰지 않는다는 원칙의 근거를 계량화한다.
    """
    findings: list[Finding] = []
    campaigns = {c.id: c for c in db.scalars(select(Campaign)).all()}
    accounts = {a.id: a.name for a in db.scalars(select(Account)).all()}
    mismatch: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for campaign_id, category in db.execute(
        select(KeywordStatDaily.campaign_id, KeywordStatDaily.product_category)
    ).all():
        if campaign_id and category:
            mismatch[campaign_id][category] += 1

    for campaign_id, categories in mismatch.items():
        campaign = campaigns.get(campaign_id)
        if campaign is None:
            continue
        label_result = classify_keyword(campaign.name)
        label_category = label_result.category if label_result.confidence >= 70 else None
        if not label_category:
            continue
        total = sum(categories.values())
        wrong = sum(count for category, count in categories.items()
                    if category not in (label_category, "미분류"))
        if total >= 5 and wrong / total >= 0.3:
            findings.append(
                Finding(
                    "CAMPAIGN_LABEL_MISMATCH",
                    NON_BLOCKING,
                    f"campaign:{campaign.name}",
                    f"{RULE_DESCRIPTIONS['CAMPAIGN_LABEL_MISMATCH']} — "
                    f"[{accounts.get(campaign.account_id)}] '{campaign.name}' 라벨={label_category}, "
                    f"실제 키워드 {wrong}/{total} 건이 다른 상품군",
                    {"label_category": label_category, "actual": dict(categories)},
                    account_ids=[campaign.account_id] if campaign.account_id else [],
                )
            )
    return findings


def validate(db: Session, promote: bool = True) -> ValidationReport:
    """전체 데이터 품질 검증. ``promote=True`` 면 통과 행을 TRUSTED 로 승격한다."""
    report = ValidationReport()

    dataset_findings = (
        _cross_account_row_duplication(db) + _cost_pattern_copy(db) + _campaign_label_mismatch(db)
    )
    report.findings.extend(dataset_findings)

    # 계정 전체를 버리지 않는다 — 문제가 확인된 '행/시트' 만 분석에서 제외하고,
    # 계정에는 경고를 남겨 상세 판단을 보류하게 한다 (§9 으라차차).
    warned_accounts = {
        account_id
        for finding in dataset_findings
        if finding.blocks_analysis
        for account_id in finding.account_ids
    }
    blocked_imports = {
        import_id
        for finding in dataset_findings
        if finding.blocks_analysis
        for import_id in finding.import_ids
    }
    rejected_keys: set[tuple[int, str, str]] = set()
    for finding in dataset_findings:
        for key in (finding.evidence or {}).get("rejected_keys", []):
            rejected_keys.add((key[0], key[1], str(key[2])))

    stats = db.scalars(select(KeywordStatDaily)).all()
    for stat in stats:
        row_findings = _row_level_findings(stat)
        report.findings.extend(row_findings)
        blocked_by_row = any(f.blocks_analysis for f in row_findings)
        blocked_by_dataset = stat.import_id in blocked_imports or (
            stat.account_id,
            stat.keyword_text or "",
            str(stat.stat_date),
        ) in rejected_keys

        if blocked_by_row or blocked_by_dataset:
            stat.trust_status = TrustStatus.REJECTED
            report.rejected_rows += 1
        elif row_findings:
            stat.trust_status = TrustStatus.WARNING
            report.warning_rows += 1
        elif promote:
            stat.trust_status = TrustStatus.TRUSTED
            report.trusted_rows += 1

    for record in db.scalars(select(HistoricalImport)).all():
        if record.id in blocked_imports:
            record.trust_status = TrustStatus.REJECTED
        elif record.account_id in warned_accounts:
            record.trust_status = TrustStatus.WARNING
        elif promote:
            record.trust_status = TrustStatus.TRUSTED

    # 경고를 영속화한다 — CEO 리포트의 '이상징후' 및 분석 차단 근거로 쓰인다.
    db.query(DataQualityWarning).delete()
    for finding in report.findings:
        # 관련된 모든 계정에 경고를 남긴다 — 한 계정만 표시하면 다른 팀이 놓친다.
        for account_id in finding.account_ids or [None]:
            db.add(
                DataQualityWarning(
                    account_id=account_id,
                    import_id=finding.import_ids[0] if finding.import_ids else None,
                    scope=finding.scope,
                    rule_code=finding.rule_code,
                    severity=finding.severity,
                    message=finding.message,
                    evidence=finding.evidence,
                    blocks_analysis=finding.blocks_analysis,
                )
            )
    db.commit()
    return report


def trusted_stats_filter():
    """분석 쿼리에서 쓰는 공통 필터 — REJECTED 데이터는 절대 집계하지 않는다."""
    return KeywordStatDaily.trust_status.in_([TrustStatus.TRUSTED, TrustStatus.WARNING])
