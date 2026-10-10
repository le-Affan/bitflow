# All data in this module is synthetic (see the fixtures modules) and runs against the separate test database
# (TEST_DATABASE_URL), never the real one.

from dataclasses import replace
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.domain.models import DayStatus, TxInput
from app.repository import DayRepository
from tests.fixtures import FIXTURE_DAY, FIXTURE_DAY_2, fixture_tx


def test_postgres_repository_satisfies_protocol(repo) -> None:
    assert isinstance(repo, DayRepository)


def test_empty_database(repo) -> None:
    assert repo.list_ingested_days() == []
    assert repo.get_latest_day() is None
    assert repo.get_day_transactions(FIXTURE_DAY) == []


def test_store_and_read_back_day(repo) -> None:
    txs = [fixture_tx(n) for n in range(1, 4)]

    record = repo.replace_day(FIXTURE_DAY, txs)

    assert record.day == FIXTURE_DAY
    assert record.status is DayStatus.INGESTED
    assert record.transaction_count == 3
    assert repo.list_ingested_days() == [record]
    stored = repo.get_day_transactions(FIXTURE_DAY)
    assert sorted(stored, key=lambda t: t.txid) == sorted(txs, key=lambda t: t.txid)
    assert all(isinstance(i.value_sat, int) for t in stored for i in t.inputs + t.outputs)


def test_replace_day_twice_replaces_not_duplicates(repo) -> None:
    repo.replace_day(FIXTURE_DAY, [fixture_tx(n) for n in range(1, 4)])
    second = [fixture_tx(n) for n in range(10, 12)]

    record = repo.replace_day(FIXTURE_DAY, second)

    assert record.transaction_count == 2
    assert [d.day for d in repo.list_ingested_days()] == [FIXTURE_DAY]
    assert sorted(t.txid for t in repo.get_day_transactions(FIXTURE_DAY)) == sorted(t.txid for t in second)


def test_replace_day_only_touches_its_own_date(repo) -> None:
    other = [fixture_tx(50, day=FIXTURE_DAY_2)]
    repo.replace_day(FIXTURE_DAY_2, other)

    repo.replace_day(FIXTURE_DAY, [fixture_tx(1)])
    repo.replace_day(FIXTURE_DAY, [fixture_tx(2)])

    assert repo.get_day_transactions(FIXTURE_DAY_2) == other


@pytest.mark.parametrize(
    "bad_batch",
    [
        # Duplicate txid: fails on the transactions insert, after the old rows were deleted.
        pytest.param(lambda: [fixture_tx(20), fixture_tx(21), fixture_tx(20)], id="duplicate-txid"),
        # Negative value: fails on the inputs insert, after transactions were inserted.
        pytest.param(
            lambda: [fixture_tx(20), replace(fixture_tx(21), inputs=(TxInput(0, "fixture-bad", -1),))],
            id="negative-input-value",
        ),
        # Block time outside the target UTC day: rejected by the schema.
        pytest.param(
            lambda: [replace(fixture_tx(20), block_time=datetime(2026, 10, 10, 0, 0, 1, tzinfo=timezone.utc))],
            id="block-time-other-day",
        ),
    ],
)
def test_failure_mid_replace_keeps_old_data(repo, bad_batch) -> None:
    original = [fixture_tx(n) for n in range(1, 4)]
    original_record = repo.replace_day(FIXTURE_DAY, original)

    with pytest.raises(IntegrityError):
        repo.replace_day(FIXTURE_DAY, bad_batch())

    assert repo.list_ingested_days() == [original_record]
    assert sorted(repo.get_day_transactions(FIXTURE_DAY), key=lambda t: t.txid) == original


def test_failed_first_ingest_leaves_day_absent(repo) -> None:
    with pytest.raises(IntegrityError):
        repo.replace_day(FIXTURE_DAY, [fixture_tx(1), fixture_tx(1)])

    assert repo.list_ingested_days() == []
    assert repo.get_latest_day() is None


def test_get_latest_day_returns_newest(repo) -> None:
    repo.replace_day(FIXTURE_DAY_2, [fixture_tx(2, day=FIXTURE_DAY_2)])
    repo.replace_day(FIXTURE_DAY, [fixture_tx(1)])

    latest = repo.get_latest_day()

    assert latest is not None and latest.day == FIXTURE_DAY_2
    assert [d.day for d in repo.list_ingested_days()] == [FIXTURE_DAY, FIXTURE_DAY_2]


def test_empty_day_is_ingested_with_zero_transactions(repo) -> None:
    record = repo.replace_day(FIXTURE_DAY, [])

    assert record.transaction_count == 0
    assert repo.get_latest_day() == record
    assert repo.get_day_transactions(FIXTURE_DAY) == []
