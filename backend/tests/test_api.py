# All data in this module is synthetic (see the fixtures modules) and runs against the separate test database
# (TEST_DATABASE_URL), never the real one.

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.api_fixtures import API_DAY, API_DAY_2, fixture_day, ftx, ftxid


@pytest.fixture
def client(repo):
    return TestClient(create_app(lambda: repo))


@pytest.fixture
def stored(repo):
    repo.replace_day(API_DAY, fixture_day())
    repo.replace_day(API_DAY_2, [ftx(50, [("fx-P", 10)], [("fx-Q", 9)], day=API_DAY_2)])
    return repo


# --- /api/days

def test_days_empty(client):
    r = client.get("/api/days")
    assert r.status_code == 200 and r.json() == []


def test_days_newest_first(client, stored):
    body = client.get("/api/days").json()
    assert [d["date"] for d in body] == ["2026-10-10", "2026-10-09"]
    assert body[1]["transaction_count"] == 4 and "ingested_at" in body[1]


# --- /api/graph

def test_graph_empty_state_404(client):
    r = client.get("/api/graph")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "no_ingested_days"
    assert r.json()["detail"]["message"]


def test_graph_defaults_to_latest_day(client, stored):
    body = client.get("/api/graph").json()
    assert body["day"] == "2026-10-10" and body["transaction_count"] == 1
    assert body["nodes"] == [{"address": "fx-P"}, {"address": "fx-Q"}]
    assert body["edges"] == [{"source": "fx-P", "target": "fx-Q", "tx_count": 1}]


def test_graph_for_given_day(client, stored):
    body = client.get("/api/graph", params={"day": "2026-10-09"}).json()
    assert body["day"] == "2026-10-09" and body["transaction_count"] == 4
    assert [n["address"] for n in body["nodes"]] == ["fx-A", "fx-B", "fx-C", "fx-D"]
    assert {(e["source"], e["target"]): e["tx_count"] for e in body["edges"]} == {
        ("fx-A", "fx-C"): 3, ("fx-A", "fx-D"): 1, ("fx-B", "fx-C"): 1, ("fx-B", "fx-D"): 1}


@pytest.mark.parametrize("path", ["/api/graph", "/api/addresses/fx-A", "/api/edges", f"/api/transactions/{ftxid(1)}"])
@pytest.mark.parametrize("bad", ["2026-13-01", "yesterday", "2026-10-9x"])
def test_invalid_day_422(client, stored, path, bad):
    r = client.get(path, params={"day": bad, "source": "fx-A", "target": "fx-C"})
    assert r.status_code == 422


@pytest.mark.parametrize("path", ["/api/graph", "/api/addresses/fx-A", "/api/edges", f"/api/transactions/{ftxid(1)}"])
def test_valid_day_not_ingested_404(client, stored, path):
    r = client.get(path, params={"day": "2026-10-01", "source": "fx-A", "target": "fx-C"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "day_not_ingested"


@pytest.mark.parametrize("path", ["/api/addresses/fx-A", "/api/edges", f"/api/transactions/{ftxid(1)}"])
def test_day_required_on_detail_endpoints(client, stored, path):
    assert client.get(path, params={"source": "fx-A", "target": "fx-C"}).status_code == 422


# --- /api/addresses/{address}

def test_address_summary(client, stored):
    body = client.get("/api/addresses/fx-A", params={"day": "2026-10-09"}).json()
    assert body == {
        "day": "2026-10-09", "address": "fx-A", "transaction_count": 3,
        "spent_sat": 1_590, "received_sat": 700, "scope": body["scope"],
    }
    assert "only" in body["scope"] and "full history" in body["scope"]
    assert all(type(body[k]) is int for k in ("spent_sat", "received_sat"))


def test_address_not_in_graph_404(client, stored):
    for addr in ("fx-E", "unknown"):  # fx-E is stored but only in a self-loop
        r = client.get(f"/api/addresses/{addr}", params={"day": "2026-10-09"})
        assert r.status_code == 404 and r.json()["detail"]["code"] == "address_not_in_graph"


def test_address_from_other_day_404(client, stored):
    assert client.get("/api/addresses/fx-P", params={"day": "2026-10-09"}).status_code == 404


# --- /api/edges

def test_edge_transactions(client, stored):
    body = client.get("/api/edges", params={"day": "2026-10-09", "source": "fx-A", "target": "fx-C"}).json()
    assert (body["source"], body["target"], body["day"]) == ("fx-A", "fx-C", "2026-10-09")
    assert [(t["txid"], t["block_height"], t["amount_to_target_sat"]) for t in body["transactions"]] == [
        (ftxid(3), 900_005, 70), (ftxid(1), 900_010, 600), (ftxid(2), 900_020, 250)]
    assert body["transactions"][0]["block_time"].startswith("2026-10-09T12:00:03")


@pytest.mark.parametrize("source,target", [("fx-C", "fx-A"), ("fx-E", "fx-E"), ("fx-A", "fx-A"), ("x", "y")])
def test_edge_not_found_404(client, stored, source, target):
    r = client.get("/api/edges", params={"day": "2026-10-09", "source": source, "target": target})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "edge_not_found"


def test_edge_missing_params_422(client, stored):
    assert client.get("/api/edges", params={"day": "2026-10-09", "source": "fx-A"}).status_code == 422


# --- /api/transactions/{txid}

def test_transaction_details(client, stored):
    body = client.get(f"/api/transactions/{ftxid(1)}", params={"day": "2026-10-09"}).json()
    assert body["txid"] == ftxid(1) and body["block_height"] == 900_010 and body["day"] == "2026-10-09"
    assert body["inputs"] == [{"position": 0, "address": "fx-A", "value_sat": 500},
                              {"position": 1, "address": "fx-B", "value_sat": 300}]
    assert body["outputs"] == [{"position": 0, "address": "fx-C", "value_sat": 600},
                               {"position": 1, "address": "fx-D", "value_sat": 150}]


def test_transaction_not_stored_for_day_404(client, stored):
    for txid, day in ((ftxid(999), "2026-10-09"), (ftxid(50), "2026-10-09"), (ftxid(1), "2026-10-10")):
        r = client.get(f"/api/transactions/{txid}", params={"day": day})
        assert r.status_code == 404 and r.json()["detail"]["code"] == "transaction_not_found"


# --- CORS and health

def test_cors_disabled_by_default(client, stored):
    r = client.get("/api/days", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in r.headers


def test_cors_allows_configured_origins(repo, monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
    c = TestClient(create_app(lambda: repo))
    ok = c.get("/api/days", headers={"Origin": "http://127.0.0.1:5173"})
    assert ok.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    other = c.get("/api/days", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in other.headers


def test_health_still_ok(client):
    assert client.get("/health").json() == {"status": "ok"}
