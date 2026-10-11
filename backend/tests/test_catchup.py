# All data in this module is synthetic (tests/ingestion_fixtures.py, tests/fixtures.py) and runs against the separate
# test database (TEST_DATABASE_URL), never the real one.
from datetime import date, datetime, timedelta, timezone

from app.domain.chain import ChainBlock
from app.ingestion.catchup import FIRST_DAILY_DAY, catch_up, missing_days
from tests.fixtures import fixture_tx
from tests.ingestion_fixtures import BASE_HEIGHT, FakeBlockSource, fx_tx

D = [FIRST_DAILY_DAY + timedelta(days=i) for i in range(-8, 7)]  # synthetic days around the first daily day


def at(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)


def multi_day_source(days: list[date], *, fail_on: date | None = None, coinbase_only: date | None = None):
    """Synthetic chain: 6 blocks per day (every 4 h from 02:00), one tx each, plus 5 blocks before and after.
    `fail_on` fails the day's 14:00 block, which no neighbouring day fetches as a margin block (margin 3)."""
    blocks, n = [], 0
    times = [at(days[0], 0) - timedelta(hours=k) for k in range(5, 0, -1)]
    for day in days:
        times += [at(day, h) for h in (2, 6, 10, 14, 18, 22)]
    times += [at(days[-1] + timedelta(days=1), 0) + timedelta(hours=k) for k in range(1, 6)]
    fail_height = None
    for i, t in enumerate(times):
        n += 1
        day = t.date()
        if day == coinbase_only:
            tx = fx_tx(n, ins=(None,), outs=(("fx-miner", 50),), coinbase=True)
        else:
            tx = fx_tx(n, value=1_000 + n)
        blocks.append(ChainBlock(height=BASE_HEIGHT + i, hash=f"{BASE_HEIGHT + i:064x}", time=t, transactions=(tx,)))
        if day == fail_on and t.hour == 14:
            fail_height = BASE_HEIGHT + i
    return FakeBlockSource(blocks, fail_at_height=fail_height)


def snapshot(repo):
    days = repo.list_ingested_days()
    return [(d.day, d.ingested_at, d.transaction_count) for d in days], repo.list_empty_days()


def test_gap_of_several_days_is_filled_oldest_first_and_today_is_never_ingested(repo):
    repo.replace_day(D[8], [fixture_tx(1, D[8])])  # the first daily day is stored
    now = at(D[12], 12)  # "today" = D[12]: D[9] .. D[11] are missing and complete
    result = catch_up(multi_day_source(D[8:13]), repo, now=lambda: now)
    assert [(d.day, d.status) for d in result.days] == [(D[9], "stored"), (D[10], "stored"), (D[11], "stored")]
    assert [d.day for d in repo.list_ingested_days()] == [D[8], D[9], D[10], D[11]]
    assert all(d.transactions == 6 for d in result.days) and not result.failed


def test_nothing_missing_is_a_noop(repo):
    now = at(D[11], 0)  # D[10] just became complete
    catch_up(multi_day_source(D[8:12]), repo, now=lambda: now)
    before = snapshot(repo)
    assert [d.day for d in repo.list_ingested_days()] == [D[8], D[9], D[10]]
    again = catch_up(multi_day_source(D[8:12]), repo, now=lambda: now)
    assert again.days == [] and not again.failed and snapshot(repo) == before


def test_failed_day_stops_the_run_keeps_earlier_days_and_the_next_run_retries_it(repo):
    now = at(D[13], 12)
    result = catch_up(multi_day_source(D[8:14], fail_on=D[10]), repo, now=lambda: now)
    assert [(d.day, d.status) for d in result.days] == [(D[8], "stored"), (D[9], "stored"), (D[10], "failed")]
    assert result.failed and [d.day for d in repo.list_ingested_days()] == [D[8], D[9]]  # D[11], D[12] not tried
    kept = snapshot(repo)
    retry = catch_up(multi_day_source(D[8:14]), repo, now=lambda: now)
    assert [d.day for d in retry.days] == [D[10], D[11], D[12]] and not retry.failed
    assert [(d.day, d.ingested_at) for d in repo.list_ingested_days()][:2] == [(a, b) for a, b, _ in kept[0]]


def test_day_without_eligible_transactions_is_recorded_as_checked_empty(repo):
    now = at(D[11], 12)
    result = catch_up(multi_day_source(D[8:12], coinbase_only=D[9]), repo, now=lambda: now)
    assert [(d.day, d.status) for d in result.days] == [(D[8], "stored"), (D[9], "empty"), (D[10], "stored")]
    assert repo.list_empty_days() == [D[9]] and not result.failed
    assert missing_days(repo, now) == []


def test_days_before_the_first_daily_day_are_never_touched(repo):
    repo.replace_day(D[0], [fixture_tx(1, D[0])])  # a history day, a week before the first daily day
    before = repo.get_day_transactions(D[0])
    now = at(D[9], 12)
    result = catch_up(multi_day_source(D[0:10]), repo, now=lambda: now)  # the source has every day
    assert [d.day for d in result.days] == [D[8]]  # starts at the first daily day, not at D[1]
    assert [d.day for d in repo.list_ingested_days()] == [D[0], D[8]] and repo.get_day_transactions(D[0]) == before
    assert all(d >= FIRST_DAILY_DAY for d in missing_days(repo, at(D[14], 0)))


def test_scheduler_next_run_is_the_next_daily_time_in_utc():
    from app.ingestion.scheduler import next_run
    assert next_run(datetime(2026, 1, 5, 0, 10, tzinfo=timezone.utc), 0, 30) == datetime(2026, 1, 5, 0, 30, tzinfo=timezone.utc)
    assert next_run(datetime(2026, 1, 5, 0, 30, tzinfo=timezone.utc), 0, 30) == datetime(2026, 1, 6, 0, 30, tzinfo=timezone.utc)
    assert next_run(datetime(2026, 1, 5, 23, 0, tzinfo=timezone.utc), 0, 30) == datetime(2026, 1, 6, 0, 30, tzinfo=timezone.utc)
