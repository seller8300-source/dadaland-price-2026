"""API 스모크 테스트 — STEP 0~6 엔드포인트가 살아 있는지 확인한다."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.demo import dataset as synthetic
from app.main import app


@pytest.fixture()
def client(seeded_db: Session) -> TestClient:
    app.dependency_overrides[get_db] = lambda: seeded_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_health_and_root(client: TestClient) -> None:
    assert client.get("/api/v1/health").json()["status"] == "ok"
    steps = client.get("/").json()["steps"]
    assert set(steps) == {f"STEP {i}" for i in range(7)}


def test_accounts_are_dynamic(client: TestClient) -> None:
    accounts = client.get("/api/v1/accounts").json()
    assert len(accounts) == 10
    created = client.post(
        "/api/v1/accounts",
        json={"name": "신규렌탈", "team": "신규", "efficiency_priority": True},
    )
    assert created.status_code == 201
    assert len(client.get("/api/v1/accounts").json()) == 11


def test_benchmark_endpoint(client: TestClient) -> None:
    base, comp = synthetic.period(2025), synthetic.period(2026)
    response = client.get(
        "/api/v1/benchmark/yoy",
        params={
            "base_start": base[0].isoformat(),
            "base_end": base[1].isoformat(),
            "comp_start": comp[0].isoformat(),
            "comp_end": comp[1].isoformat(),
        },
    )
    payload = response.json()
    assert response.status_code == 200
    assert payload["company"]["explanation"]
    mani = next(a for a in payload["accounts"] if a["account"] == "마니")
    assert "EFFICIENCY_WARNING" in mani["flags"]


def test_quality_endpoints(client: TestClient) -> None:
    validation = client.post("/api/v1/quality/validate").json()
    assert validation["summary"]["blocking"] >= 1
    warnings = client.get("/api/v1/quality/warnings").json()
    assert any(w["rule"] == "COST_PATTERN_COPIED_BETWEEN_ACCOUNTS" for w in warnings)


def test_competition_endpoint(client: TestClient) -> None:
    comp = synthetic.period(2026)
    response = client.get(
        "/api/v1/competition",
        params={"start": comp[0].isoformat(), "end": comp[1].isoformat()},
    )
    payload = response.json()
    assert "allowed_competition_spend" in payload
    assert "reallocation_review_spend" in payload
    assert payload["clusters"]


def test_policy_violation_endpoint(client: TestClient) -> None:
    comp = synthetic.period(2026)
    violations = client.get(
        "/api/v1/policy/violations",
        params={"start": comp[0].isoformat(), "end": comp[1].isoformat()},
    ).json()
    assert any(v["account"] == "현대도크" for v in violations)


def test_daily_report_endpoints(client: TestClient) -> None:
    as_of = date(2026, 8, 31).isoformat()
    payload = client.get("/api/v1/reports/daily", params={"as_of": as_of}).json()
    assert payload["as_of"] == as_of

    text = client.get("/api/v1/reports/daily.txt", params={"as_of": as_of}).text
    assert "DADA 광고 데일리 리포트" in text

    message = client.post(
        "/api/v1/reports/daily/agency-message",
        params={"as_of": as_of},
        json={"approved_by": "CEO", "selected": [1, 2]},
    ).text
    assert "다다랜드" in message


def test_tracking_endpoint_accepts_beacon_payload(client: TestClient) -> None:
    response = client.post(
        "/api/v1/track/event",
        content=(
            '{"conversion_type": "QUOTE_REQUEST", "account_name": "타임렌탈", '
            '"landing_url": "https://timerental.co.kr/?n_keyword=인천 이동식에어컨렌탈", '
            '"visitor_id": "v-9"}'
        ).encode(),
        headers={"Content-Type": "text/plain;charset=UTF-8"},
    )
    assert response.status_code == 202
    assert response.json()["attribution_method"] == "NAVER_URL_PARAM"


def test_tracking_rejects_unknown_type(client: TestClient) -> None:
    response = client.post("/api/v1/track/event", json={"conversion_type": "UNKNOWN"})
    assert response.status_code == 400


def test_naver_status_is_read_only(client: TestClient) -> None:
    payload = client.get("/api/v1/naver/status").json()
    assert payload["read_only"] is True
    assert "READ ONLY" not in payload["policy"] or "자동 변경하지 않는다" in payload["policy"]


def test_recommendation_lifecycle(client: TestClient) -> None:
    created = client.post(
        "/api/v1/recommendations",
        json={
            "account_name": "마니",
            "as_of_date": "2026-08-31",
            "action_type": "BID_DOWN",
            "title": "코끼리에어컨 입찰가 -20%",
            "detail": "평균순위 1.6위 유지 중 — 2~3위 구간 테스트",
            "keyword_text": "코끼리에어컨",
            "confidence": 82,
            "evidence": [{"code": "CPC_SPIKE", "detail": "CPC +153%"}],
        },
    ).json()
    assert created["baseline"]["clicks"] >= 0

    approved = client.post(
        f"/api/v1/recommendations/{created['id']}/approve", params={"approved_by": "CEO"}
    ).json()
    assert approved["status"] == "APPROVED"

    evaluated = client.post(
        f"/api/v1/recommendations/{created['id']}/evaluate",
        params={"measured_on": "2026-08-31"},
    ).json()
    assert evaluated["outcome"] in {"SUCCESS", "NEUTRAL", "FAILURE", "PENDING", "DATA_INSUFFICIENT"}
