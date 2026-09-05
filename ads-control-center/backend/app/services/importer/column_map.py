"""케이오 Excel / RAW export 의 한글 헤더를 표준 필드로 매핑한다 (§32).

원본 export 는 계정마다 헤더가 조금씩 다르므로, 정규화된 헤더 문자열에
대한 별칭 사전을 둔다. 알 수 없는 컬럼은 버리지 않고 raw_row 에 보존한다.
"""
from __future__ import annotations

import re
from datetime import date, datetime

CANONICAL_FIELDS = (
    "date",
    "account",
    "campaign",
    "adgroup",
    "keyword",
    "keyword_id",
    "search_term",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cost",
    "average_rank",
    "device",
    "creative",
    "landing_url",
    "conversions",
    "conversion_value",
    "quality_index",
)

ALIASES: dict[str, tuple[str, ...]] = {
    "date": ("날짜", "일자", "기간", "date", "일", "리포트일자", "통계일"),
    "account": ("계정", "계정명", "account", "광고주", "고객사"),
    "campaign": ("캠페인", "캠페인명", "campaign", "캠페인이름"),
    "adgroup": ("광고그룹", "광고그룹명", "adgroup", "adgroupname", "그룹명"),
    "keyword": ("키워드", "keyword", "키워드명", "등록키워드"),
    "keyword_id": ("키워드id", "keywordid", "키워드아이디", "nccKeywordId".lower()),
    "search_term": ("검색어", "실제검색어", "searchterm", "쿼리", "유입검색어"),
    "impressions": ("노출수", "노출", "impression", "impressions", "노출횟수"),
    "clicks": ("클릭수", "클릭", "click", "clicks", "클릭횟수"),
    "ctr": ("클릭률", "ctr", "클릭율", "클릭률%"),
    "cpc": ("평균클릭비용", "cpc", "평균cpc", "클릭당비용", "평균클릭단가"),
    "cost": ("총비용", "비용", "광고비", "cost", "총광고비", "지출", "소진금액"),
    "average_rank": ("평균노출순위", "평균순위", "노출순위", "averagerank", "avgrank", "순위"),
    "device": ("디바이스", "device", "기기", "매체"),
    "creative": ("소재", "광고소재", "creative", "제목"),
    "landing_url": ("랜딩url", "연결url", "landingurl", "url", "표시url", "링크"),
    "conversions": ("전환수", "전환", "conversion", "conversions", "전환건수"),
    "conversion_value": ("전환매출액", "전환매출", "conversionvalue", "매출액"),
    "quality_index": ("품질지수", "qualityindex", "품질"),
}

_NORMALIZED_ALIASES: dict[str, str] = {}


def _norm_header(value: object) -> str:
    return re.sub(r"[\s_\-()%/·.]", "", str(value or "")).lower()


for _field, _aliases in ALIASES.items():
    for _alias in _aliases:
        _NORMALIZED_ALIASES[_norm_header(_alias)] = _field


def map_headers(headers: list[object]) -> dict[int, str]:
    """헤더 목록 → {열 index: 표준 필드명}. 매칭 실패 컬럼은 포함하지 않는다."""
    mapping: dict[int, str] = {}
    for idx, header in enumerate(headers):
        norm = _norm_header(header)
        if not norm:
            continue
        field = _NORMALIZED_ALIASES.get(norm)
        if field is None:
            # 부분 일치 (예: '총비용(VAT제외)') — 가장 긴 별칭이 우선
            candidates = [
                (alias, f) for alias, f in _NORMALIZED_ALIASES.items() if alias and alias in norm
            ]
            if candidates:
                field = max(candidates, key=lambda pair: len(pair[0]))[1]
        if field and field not in mapping.values():
            mapping[idx] = field
    return mapping


_NUMERIC_RE = re.compile(r"-?\d+(?:\.\d+)?")


def to_number(value: object) -> float | None:
    """'1,233원', '6.89%', '' 같은 표기를 숫자로 바꾼다. 실패하면 None."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "–", "N/A", "na", "없음"}:
        return None
    match = _NUMERIC_RE.search(text)
    return float(match.group()) if match else None


def to_int(value: object) -> int:
    number = to_number(value)
    return int(round(number)) if number is not None else 0


_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d", "%m/%d/%Y", "%Y-%m", "%Y.%m")


def to_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        return parsed.date()
    # '2026년 3월 4일' 같은 표기
    numbers = re.findall(r"\d+", text)
    if len(numbers) >= 3:
        try:
            return date(int(numbers[0]), int(numbers[1]), int(numbers[2]))
        except ValueError:
            return None
    if len(numbers) == 2:
        try:
            return date(int(numbers[0]), int(numbers[1]), 1)
        except ValueError:
            return None
    return None
