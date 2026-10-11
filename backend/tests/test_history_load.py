# All data in this module is synthetic (tests/ingestion_fixtures.py, tests/fixtures.py) and runs against the separate
# test database (TEST_DATABASE_URL), never the real one.
from datetime import date

import pytest

from app.ingestion.history import load_days
from tests.fixtures import fixture_tx
from tests.ingestion_fixtures import NOW, FakeBlockSource, fx_block, fx_chain, fx_tx, fx_txid

DAY = date(2026, 10, 9)
BEFORE = date(2026, 10, 10)


def chain(*txs):
    return FakeBlockSource(fx_chain([fx_block(0, 60, tuple(txs))]))


def snapshot(repo):
    return [(d.day, d.ingested_at, d.transaction_count) for d in repo.list_ingested_days()], \
        {d.day: repo.get_day_transactions(d.day) for d in repo.list_ingested_days()}


def test_loads_then_rerun_skips_and_creates_no_duplicates(repo):
    first = load_days([DAY], chain(fx_tx(1), fx_tx(2)), repo, before=BEFORE, now=NOW)
    assert [(o.status, o.transactions) for o in first] == [("loaded", 2)]
    before = snapshot(repo)
    second = load_days([DAY], chain(fx_tx(1), fx_tx(2)), repo, before=BEFORE, now=NOW)
    assert [o.status for o in second] == ["skipped"]
    assert snapshot(repo) == before  # same ingested_at, same rows: nothing rewritten


def test_existing_day_is_never_overwritten_even_with_different_data(repo):
    repo.replace_day(DAY, [fixture_tx(7)])
    before = snapshot(repo)
    out = load_days([DAY], chain(fx_tx(1)), repo, before=BEFORE, now=NOW)
    assert [o.status for o in out] == ["skipped"] and snapshot(repo) == before


def test_refuses_days_on_or_after_cutoff_before_touching_anything(repo):
    with pytest.raises(ValueError):
        load_days([date(2026, 10, 8), BEFORE], chain(fx_tx(1)), repo, before=BEFORE, now=NOW)
    assert repo.list_ingested_days() == []


def test_day_without_eligible_transactions_is_empty_not_stored(repo):
    coinbase_only = fx_tx(1, ins=(None,), outs=(("fx-miner", 50),), coinbase=True)
    out = load_days([DAY], chain(coinbase_only), repo, before=BEFORE, now=NOW)
    assert [o.status for o in out] == ["empty"] and repo.list_ingested_days() == []


def test_day_without_blocks_is_empty(repo):
    out = load_days([date(2026, 10, 1)], chain(fx_tx(1)), repo, before=BEFORE, now=NOW)
    assert [o.status for o in out] == ["empty"] and "listed no blocks" in out[0].detail


def test_failing_day_is_reported_and_does_not_affect_other_days(repo):
    src = FakeBlockSource(fx_chain([fx_block(0, 60, (fx_tx(1),))]), fail_at_height=800_000)
    out = load_days([DAY], src, repo, before=BEFORE, now=NOW)
    assert [o.status for o in out] == ["failed"] and repo.list_ingested_days() == []


def test_fewer_than_100_transactions_are_stored_as_they_are(repo):
    out = load_days([DAY], chain(*(fx_tx(n) for n in range(1, 8))), repo, before=BEFORE, now=NOW)
    assert out[0].transactions == 7
    assert sorted(t.txid for t in repo.get_day_transactions(DAY)) == sorted(fx_txid(n) for n in range(1, 8))
