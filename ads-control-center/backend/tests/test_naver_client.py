"""STEP 4 — NAVER API 클라이언트 (READ ONLY, §30)."""
from __future__ import annotations

import base64
import hashlib
import hmac

import httpx
import pytest

from app.services.naver.client import (
    NaverCredentials,
    NaverSearchAdClient,
    ReadOnlyViolation,
    make_signature,
)


def _client(handler, read_only: bool = True) -> NaverSearchAdClient:
    transport = httpx.MockTransport(handler)
    return NaverSearchAdClient(
        NaverCredentials("key", "secret", "1234567"),
        base_url="https://api.example.test",
        read_only=read_only,
        client=httpx.Client(transport=transport),
    )


def test_signature_matches_naver_spec() -> None:
    signature = make_signature("1700000000000", "GET", "/ncc/campaigns", "secret")
    expected = base64.b64encode(
        hmac.new(b"secret", b"1700000000000.GET./ncc/campaigns", hashlib.sha256).digest()
    ).decode()
    assert signature == expected


def test_get_sends_auth_headers() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(request.headers)
        return httpx.Response(200, json=[{"nccCampaignId": "cmp-1", "name": "냉방_파워링크"}])

    client = _client(handler)
    campaigns = client.campaigns()
    assert campaigns[0]["nccCampaignId"] == "cmp-1"
    assert captured["x-api-key"] == "key"
    assert captured["x-customer"] == "1234567"
    assert captured["x-signature"]


@pytest.mark.parametrize("method", ["post", "put", "delete"])
def test_write_methods_are_blocked(method: str) -> None:
    """AI 는 입찰가나 광고를 자동으로 변경하지 않는다 (§30)."""
    client = _client(lambda request: httpx.Response(200, json={}))
    with pytest.raises(ReadOnlyViolation):
        if method == "delete":
            getattr(client, method)("/ncc/keywords/kw-1")
        else:
            getattr(client, method)("/ncc/keywords", {"bidAmt": 1000})


def test_write_allowed_only_when_read_only_disabled_explicitly() -> None:
    client = _client(lambda request: httpx.Response(200, json={"ok": True}), read_only=False)
    assert client.post("/ncc/keywords", {"bidAmt": 1000}) == {"ok": True}


def test_retention_metadata_does_not_assume_permanent_restore() -> None:
    """§31 — API 로 영구 복원이 가능하다고 가정하지 않는다."""
    from app.services.naver.sync import retention_metadata

    metadata = retention_metadata()
    assert metadata["report_retention_days"]["STAT_REPORT"] is None
    assert "RAW REPORT" in metadata["policy"]
