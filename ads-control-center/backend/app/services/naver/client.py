"""STEP 4 — NAVER 검색광고 API 클라이언트 (READ ONLY, §30).

초기 운영 원칙: AI 는 입찰가/광고를 자동으로 변경하지 않는다.
그래서 이 클라이언트는 GET 만 허용하고, 쓰기 메서드를 시도하면 예외를 던진다.
쓰기 권한이 필요해지는 시점은 'CEO 승인 → 케이오마케팅 실행' 프로세스가
바뀌는 시점이며, 그때도 이 가드는 명시적으로 해제되어야 한다.

인증: API Key / Secret Key 는 .env 에서만 읽는다. 코드에 하드코딩하지 않는다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings


class ReadOnlyViolation(RuntimeError):
    """READ ONLY 모드에서 쓰기 요청을 시도했을 때."""


class NaverApiError(RuntimeError):
    pass


def make_signature(timestamp: str, method: str, path: str, secret_key: str) -> str:
    message = f"{timestamp}.{method}.{path}"
    digest = hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


@dataclass(slots=True)
class NaverCredentials:
    api_key: str
    secret_key: str
    customer_id: str

    @classmethod
    def from_settings(cls, customer_id: str) -> NaverCredentials:
        if not settings.naver_api_key or not settings.naver_secret_key:
            raise NaverApiError(
                "NAVER API 자격증명이 없습니다. .env 의 NAVER_API_KEY / NAVER_SECRET_KEY 를 설정하세요."
            )
        return cls(settings.naver_api_key, settings.naver_secret_key, customer_id)


class NaverSearchAdClient:
    """검색광고 API 읽기 전용 래퍼."""

    def __init__(
        self,
        credentials: NaverCredentials,
        base_url: str | None = None,
        read_only: bool | None = None,
        client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.credentials = credentials
        self.base_url = (base_url or settings.naver_api_base_url).rstrip("/")
        self.read_only = settings.naver_read_only if read_only is None else read_only
        self._client = client or httpx.Client(timeout=timeout)

    # --- 내부 ---------------------------------------------------------
    def _headers(self, method: str, path: str) -> dict[str, str]:
        timestamp = str(int(time.time() * 1000))
        return {
            "X-Timestamp": timestamp,
            "X-API-KEY": self.credentials.api_key,
            "X-Customer": str(self.credentials.customer_id),
            "X-Signature": make_signature(timestamp, method, path, self.credentials.secret_key),
            "Content-Type": "application/json; charset=UTF-8",
        }

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        method = method.upper()
        if self.read_only and method != "GET":
            raise ReadOnlyViolation(
                f"READ ONLY 모드에서는 {method} {path} 요청을 보낼 수 없습니다. "
                "광고 변경은 CEO 승인 후 케이오마케팅이 집행합니다 (§30)."
            )
        response = self._client.request(
            method, f"{self.base_url}{path}", headers=self._headers(method, path), **kwargs
        )
        if response.status_code >= 400:
            raise NaverApiError(f"{method} {path} → {response.status_code}: {response.text[:300]}")
        if not response.content:
            return None
        return response.json()

    def get(self, path: str, params: dict | None = None) -> Any:
        return self.request("GET", path, params=params)

    # 쓰기 메서드는 의도적으로 가드만 둔다.
    def post(self, path: str, json: dict | None = None) -> Any:
        return self.request("POST", path, json=json)

    def put(self, path: str, json: dict | None = None) -> Any:
        return self.request("PUT", path, json=json)

    def delete(self, path: str) -> Any:
        return self.request("DELETE", path)

    # --- 조회 API -----------------------------------------------------
    def campaigns(self) -> list[dict]:
        return self.get("/ncc/campaigns") or []

    def adgroups(self, campaign_id: str | None = None) -> list[dict]:
        params = {"nccCampaignId": campaign_id} if campaign_id else None
        return self.get("/ncc/adgroups", params) or []

    def keywords(self, adgroup_id: str) -> list[dict]:
        return self.get("/ncc/keywords", {"nccAdgroupId": adgroup_id}) or []

    def ads(self, adgroup_id: str) -> list[dict]:
        """등록 소재 (§23 제목/설명/URL/확장소재)."""
        return self.get("/ncc/ads", {"nccAdgroupId": adgroup_id}) or []

    def stat_report(self, report_type: str) -> dict:
        """StatReport 생성 요청은 POST 라 READ ONLY 에서는 막힌다.

        대신 마스터 리포트(/master-reports) 또는 /stats 조회를 사용한다.
        """
        return self.get("/stats", {"reportTp": report_type}) or {}

    def stats(self, ids: list[str], fields: list[str], time_range: dict, breakdown: str | None = None) -> Any:
        import json as _json

        params = {
            "ids": ",".join(ids),
            "fields": _json.dumps(fields),
            "timeRange": _json.dumps(time_range),
        }
        if breakdown:
            params["breakdown"] = breakdown
        return self.get("/stats", params)

    def master_reports(self) -> list[dict]:
        return self.get("/master-reports") or []

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> NaverSearchAdClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


# 리포트별 API 데이터 보존기간 메타 (§31) — 값은 운영 중 확인되는 대로 갱신한다.
REPORT_RETENTION_DAYS: dict[str, int | None] = {
    "AD": 365,
    "AD_DETAIL": 365,
    "AD_CONVERSION": 365,
    "AD_CONVERSION_DETAIL": 365,
    "EXPKEYWORD": 90,      # 검색어(실제 검색어) 리포트는 보존기간이 짧다
    "STAT_REPORT": None,   # 미확인 — 확인 전까지 영구 복원 가능하다고 가정하지 않는다
}
