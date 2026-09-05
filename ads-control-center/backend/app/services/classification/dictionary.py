"""키워드 문자열 분류 사전 (§10).

캠페인명은 Source of Truth 가 아니다 (§9). 상품군은 오직 키워드 문자열로 판단한다.
사전은 코드 기본값 + DB(business_rules / keyword_classification) 오버라이드 구조다.
"""
from __future__ import annotations

from app.core.enums import ProductCategory

# 1순위: 사용자 정의 키워드 사전 (정확 일치, normalized)
USER_DICTIONARY: dict[str, str] = {
    "코끼리에어컨": ProductCategory.COOLING,
    "코끼리코에어컨": ProductCategory.COOLING,
    "코끼리냉풍기": ProductCategory.COOLING,
    "이동식에어컨": ProductCategory.COOLING,
    "산업용제습기": ProductCategory.COOLING,
    "업소용냉장고": ProductCategory.KITCHEN,
    "이동식도크": ProductCategory.LOGISTICS,
    "컨테이너도크": ProductCategory.LOGISTICS,
}

# 2순위: 정확한 상품명 패턴 (부분 문자열, 길이가 긴 항목이 먼저 매칭된다)
PRODUCT_TERMS: dict[str, list[str]] = {
    ProductCategory.COOLING: [
        "에어컨", "냉풍기", "제습기", "이동식에어컨", "스탠드에어컨", "산업용선풍기",
        "선풍기", "쿨러", "냉방기", "이동식냉방", "공랭식", "스팟쿨러", "에어쿨러",
    ],
    ProductCategory.HEATING: [
        "난방기", "온풍기", "열풍기", "히터", "전기히터", "등유히터", "난로",
        "온수매트", "전기매트", "난방텐트",
    ],
    ProductCategory.LOGISTICS: [
        "이동식도크", "컨테이너도크", "도크", "롤테이너", "대차", "스태커",
        "지게차", "핸드파렛트", "파렛트", "팔레트", "물류장비", "운반대차", "리프트",
    ],
    ProductCategory.EVENT: [
        "행사집기", "행사용품", "부스", "천막", "몽골텐트", "무대", "발전기",
        "펜스", "아이스박스", "간이의자", "행사테이블", "축제", "박람회", "페어",
        "전시부스", "돔텐트",
    ],
    ProductCategory.KITCHEN: [
        "업소용냉장고", "냉장고", "냉동고", "쇼케이스", "제빙기", "온장고",
        "테이블냉장고", "김치냉장고", "음료냉장고", "주방집기", "튀김기", "그리들",
    ],
    ProductCategory.BEDDING: [
        "이불", "침구", "요이불", "매트리스", "침대", "베개", "담요", "이부자리",
    ],
    ProductCategory.XMAS_TREE: [
        "크리스마스트리", "트리", "성탄트리", "대형트리", "트리장식",
    ],
}

# 렌탈 의도 표현 (§15)
RENTAL_TERMS: tuple[str, ...] = ("렌탈", "렌털", "대여", "임대", "리스", "단기임대", "장기렌탈")

# 기간/용도 의도 표현
SHORT_TERM_TERMS: tuple[str, ...] = ("단기", "하루", "1일", "일주일", "주말", "당일")
USE_TERMS: tuple[str, ...] = (
    "행사장", "촬영장", "공사장", "야외", "창고", "물류센터", "공장", "사무실",
    "매장", "캠핑", "축제장", "체육관", "교회", "학교",
)

# 지역 (§16) — 광역/주요 도시 + 수도권 상권
REGIONS: tuple[str, ...] = (
    "서울", "인천", "경기", "수원", "성남", "분당", "용인", "고양", "일산", "부천",
    "안양", "안산", "화성", "평택", "의정부", "남양주", "파주", "김포", "광명",
    "시흥", "군포", "하남", "이천", "여주", "양주", "구리", "오산",
    "부산", "대구", "광주", "대전", "울산", "세종", "청주", "천안", "전주", "포항",
    "창원", "김해", "제주", "강릉", "원주", "춘천", "여수", "순천", "목포", "익산",
    "강남", "서초", "송파", "삼성동", "역삼", "논현", "잠실", "여의도", "마포",
    "홍대", "용산", "종로", "성수", "강서", "구로", "가산", "영등포", "노원",
    "송도", "청라", "동탄", "위례", "판교",
)

# 주요 행사장 (§22)
VENUES: tuple[str, ...] = (
    "코엑스", "킨텍스", "세텍", "SETEC", "aT센터", "at센터", "송도컨벤시아",
    "벡스코", "BEXCO", "엑스코", "EXCO", "디큐브", "수원컨벤션", "대전컨벤션",
    "광주김대중컨벤션", "제주ICC", "고양체육관", "올림픽공원", "잠실주경기장",
)

# 현대도크 정책 (§6): 물류장비 ONLY
LOGISTICS_ONLY_ACCOUNT = "현대도크"

# 이불/침구 Primary (§19)
BEDDING_PRIMARY_ACCOUNT = "OMBC"


def normalize(text: str) -> str:
    """공백/기호 제거 + 소문자화. 한글 키워드는 띄어쓰기 변형이 매우 흔하다."""
    if text is None:
        return ""
    cleaned = [ch.lower() for ch in str(text) if ch.isalnum()]
    return "".join(cleaned)


NORMALIZED_USER_DICTIONARY = {normalize(k): v for k, v in USER_DICTIONARY.items()}
