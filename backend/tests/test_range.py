# All data in this module is synthetic (tests/api_fixtures.py helpers) and runs against the test database.
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.domain.models import Transaction
from app.main import create_app
from tests.api_fixtures import ftx, ftxid

D1, D2, D3, D4 = date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3), date(2026, 1, 4)  # D3: nothing stored


def reference_ranking_value(tx: Transaction) -> int | None:
    """The ranking rule, written plainly: largest output to an address that is not one of the tx's input addresses."""
    ins = {i.address for i in tx.inputs}
    values = [o.value_sat for o in tx.outputs if o.address not in ins]
    return max(values) if values else None


def reference_top(txs: list[Transaction], n: int) -> list[str]:
    ranked = [(v, t.txid) for t in txs if (v := reference_ranking_value(t)) is not None]
    return [txid for _, txid in sorted(ranked, key=lambda r: (-r[0], r[1]))[:n]]


def range_days() -> dict[date, list[Transaction]]:
    return {
        D1: [
            ftx(1, [("fx-A", 900)], [("fx-B", 500), ("fx-A", 390)], day=D1),       # value 500 (change to A ignored)
            ftx(2, [("fx-C", 9_000)], [("fx-C", 8_000), ("fx-D", 100)], day=D1),   # value 100: big change ignored
            ftx(3, [("fx-E", 700)], [("fx-F", 600)], day=D1),                     # value 600
        ],
        D2: [
            ftx(4, [("fx-A", 700)], [("fx-G", 600)], day=D2),                     # value 600, tie with tx3
            ftx(5, [("fx-H", 50)], [("fx-H", 40)], day=D2),                       # only change: not ranked
            ftx(6, [("fx-B", 2_000), ("fx-I", 1)], [("fx-J", 1_500), ("fx-K", 400)], day=D2),  # value 1500
        ],
        D4: [ftx(7, [("fx-L", 300)], [("fx-M", 250)], day=D4)],                   # value 250
    }


@pytest.fixture
def stored(repo):
    for day, txs in range_days().items():
        repo.replace_day(day, txs)
    return repo


def test_range_ranking_matches_the_rule_across_days(stored):
    all_txs = [t for txs in range_days().values() for t in txs]
    for n in (1, 3, 5, 100):
        got = stored.get_range_transactions(D1, D4, n)
        assert sorted(t.txid for t in got) == sorted(reference_top(all_txs, n))
    # ties by txid ascending: tx3 and tx4 both rank 600, limit 3 keeps tx6 (1500) then tx3, tx4
    assert {t.txid for t in stored.get_range_transactions(D1, D4, 3)} == {ftxid(6), ftxid(3), ftxid(4)}
    assert {t.txid for t in stored.get_range_transactions(D1, D4, 2)} == {ftxid(6), ftxid(3)}


def test_range_returns_full_transactions_and_skips_days_outside(stored):
    got = stored.get_range_transactions(D2, D3, 100)
    assert {t.txid for t in got} == {ftxid(4), ftxid(6)}  # D1 and D4 outside, tx5 not ranked
    tx6 = next(t for t in got if t.txid == ftxid(6))
    assert [i.address for i in tx6.inputs] == ["fx-B", "fx-I"] and [o.value_sat for o in tx6.outputs] == [1_500, 400]
    assert stored.get_range_transactions(D3, D3, 100) == []


def test_single_day_range_equals_the_day_without_unranked(stored):
    assert {t.txid for t in stored.get_range_transactions(D2, D2, 100)} == {ftxid(4), ftxid(6)}


@pytest.fixture
def client(stored):
    return TestClient(create_app(lambda: stored))


def test_graph_range(client):
    r = client.get("/api/graph", params={"start": "2026-01-01", "end": "2026-01-04"})
    assert r.status_code == 200
    body = r.json()
    assert body["start"] == "2026-01-01" and body["end"] == "2026-01-04" and "day" not in body and "status" not in body
    assert body["transaction_count"] == 6  # tx5 has no outward output
    edges = {(e["source"], e["target"]): e["tx_count"] for e in body["edges"]}
    assert edges[("fx-A", "fx-B")] == 1 and edges[("fx-A", "fx-G")] == 1 and ("fx-A", "fx-A") not in edges


def test_single_day_response_unchanged(client):
    body = client.get("/api/graph", params={"day": "2026-01-02"}).json()
    assert set(body) == {"day", "transaction_count", "nodes", "edges"} and body["transaction_count"] == 3


def test_range_without_data_is_not_ingested(client):
    r = client.get("/api/graph", params={"start": "2026-01-03", "end": "2026-01-03"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "day_not_ingested"


def test_range_of_only_checked_empty_days_is_empty(client, stored):
    stored.record_empty_days([date(2025, 12, 30), date(2025, 12, 31)])
    r = client.get("/api/graph", params={"start": "2025-12-30", "end": "2025-12-31"})
    assert r.status_code == 200
    assert r.json() == {"start": "2025-12-30", "end": "2025-12-31", "transaction_count": 0, "nodes": [], "edges": [],
                        "status": "no_eligible_transactions"}
    # partly checked, partly unknown: no data
    r = client.get("/api/graph", params={"start": "2025-12-29", "end": "2025-12-31"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "day_not_ingested"


@pytest.mark.parametrize("params,field", [
    ({"start": "2026-01-04", "end": "2026-01-01"}, "end"),
    ({"start": "2026-01-01"}, "end"),
    ({"end": "2026-01-01"}, "start"),
    ({"day": "2026-01-01", "start": "2026-01-01", "end": "2026-01-02"}, "day"),
    ({"start": "2026-01-01", "end": "9999-12-31"}, "end"),
])
def test_range_validation_422(client, params, field):
    r = client.get("/api/graph", params=params)
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["query", field]


def test_detail_endpoints_with_range(client):
    rng = {"start": "2026-01-01", "end": "2026-01-04"}
    a = client.get("/api/addresses/fx-A", params=rng).json()
    assert a["transaction_count"] == 2 and a["spent_sat"] == 1_600 and a["received_sat"] == 390
    assert "selected range" in a["scope"] and a["start"] == "2026-01-01" and "day" not in a
    e = client.get("/api/edges", params={**rng, "source": "fx-B", "target": "fx-J"}).json()
    assert [t["txid"] for t in e["transactions"]] == [ftxid(6)]
    t = client.get(f"/api/transactions/{ftxid(4)}", params=rng).json()
    assert t["end"] == "2026-01-04" and t["outputs"][0]["address"] == "fx-G"
    r = client.get(f"/api/transactions/{ftxid(5)}", params=rng)  # stored, but not in the range's top 100
    assert r.status_code == 404 and r.json()["detail"]["code"] == "transaction_not_found"


def test_detail_endpoints_still_need_day_or_range(client):
    assert client.get("/api/addresses/fx-A").status_code == 422
