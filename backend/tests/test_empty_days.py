# All data in this module is synthetic (tests/fixtures.py, tests/api_fixtures.py) and runs against the separate test
# database (TEST_DATABASE_URL), never the real one.
import json
import os
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.ingestion import empty_days_cli
from app.main import create_app
from tests.api_fixtures import API_DAY, fixture_day

EMPTY = date(2026, 10, 1)


# --- repository

def test_record_empty_days_is_idempotent(repo):
    assert repo.record_empty_days([EMPTY, date(2026, 10, 2), EMPTY]) == 2
    assert repo.record_empty_days([EMPTY, date(2026, 10, 2)]) == 0  # re-run: nothing new, no duplicates
    assert repo.list_empty_days() == [EMPTY, date(2026, 10, 2)]
    assert repo.is_day_empty(EMPTY) and not repo.is_day_empty(date(2026, 10, 3))


def test_ingested_day_is_never_recorded_as_empty(repo):
    repo.replace_day(API_DAY, fixture_day())
    assert repo.record_empty_days([API_DAY]) == 0
    assert repo.list_empty_days() == []


def test_empty_days_do_not_change_ingested_days(repo):
    repo.record_empty_days([EMPTY])
    assert repo.list_ingested_days() == [] and repo.get_latest_day() is None


# --- fill step (re-runnable)

@pytest.fixture
def state_file(tmp_path):
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"empty_days": ["2009-01-03", "2009-01-04", "2026-10-09", "2026-10-10"]}))
    return p


def test_fill_from_state_file_respects_cutoff_and_reruns_without_duplicates(repo, state_file, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    assert empty_days_cli.main(["--state", str(state_file), "--before", "2026-10-09"]) == 0
    first = json.loads(capsys.readouterr().out)
    assert first == {"in_state_file": 4, "before_cutoff": 2, "ignored_on_or_after_cutoff": 2, "newly_recorded": 2, "total_recorded": 2}
    assert empty_days_cli.main(["--state", str(state_file), "--before", "2026-10-09"]) == 0
    second = json.loads(capsys.readouterr().out)
    assert second["newly_recorded"] == 0 and second["total_recorded"] == 2
    assert repo.list_empty_days() == [date(2009, 1, 3), date(2009, 1, 4)]


# --- API: (a) stored, (b) checked and empty, (c) no data

@pytest.fixture
def client(repo):
    repo.replace_day(API_DAY, fixture_day())
    repo.record_empty_days([EMPTY])
    return TestClient(create_app(lambda: repo))


def test_case_a_stored_day_response_unchanged(client):
    body = client.get("/api/graph", params={"day": "2026-10-09"}).json()
    assert set(body) == {"day", "transaction_count", "nodes", "edges"}  # no new field for stored days
    assert body["transaction_count"] == 4 and len(body["nodes"]) == 4


def test_case_b_checked_empty_day_returns_explicit_empty_graph(client):
    r = client.get("/api/graph", params={"day": "2026-10-01"})
    assert r.status_code == 200
    assert r.json() == {"day": "2026-10-01", "transaction_count": 0, "nodes": [], "edges": [], "status": "no_eligible_transactions"}


@pytest.mark.parametrize("path,params,code", [
    ("/api/addresses/fx-A", {}, "address_not_in_graph"),
    ("/api/edges", {"source": "fx-A", "target": "fx-C"}, "edge_not_found"),
    ("/api/transactions/" + "0" * 64, {}, "transaction_not_found"),
])
def test_case_b_detail_endpoints_are_not_found_with_their_usual_codes(client, path, params, code):
    r = client.get(path, params={"day": "2026-10-01", **params})
    assert r.status_code == 404 and r.json()["detail"]["code"] == code
    assert "no eligible transactions" in r.json()["detail"]["message"]


def test_case_c_no_data_unchanged(client):
    r = client.get("/api/graph", params={"day": "2026-10-03"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "day_not_ingested"


def test_days_list_and_default_day_unchanged(client):
    assert [d["date"] for d in client.get("/api/days").json()] == ["2026-10-09"]
    assert client.get("/api/graph").json()["day"] == "2026-10-09"
