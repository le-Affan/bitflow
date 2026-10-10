# All data in this module is synthetic (see the fixtures modules) and runs against the separate test database
# (TEST_DATABASE_URL), never the real one.

from datetime import date, datetime, timedelta, timezone

import pytest

from app.ingestion.core import (
    InvalidTargetDayError,
    NoEligibleTransactionsError,
    RunningTop,
    has_edge,
    ingest_day,
    rank_key,
)
from app.ingestion.source import BlockSource, SourceError
from tests.fixtures import fixture_tx
from tests.ingestion_fixtures import (
    BASE_HEIGHT,
    DAY_START,
    NOW,
    FakeBlockSource,
    fx_block,
    fx_chain,
    fx_tx,
    fx_txid,
)

DAY = date(2026, 10, 9)


def run(blocks, repo, **kw):
    return ingest_day(DAY, FakeBlockSource(blocks, **{k: v for k, v in kw.items() if k != "margin"}),
                      repo, margin=kw.get("margin", 3), now=NOW)


def stored_txids(repo):
    return sorted(t.txid for t in repo.get_day_transactions(DAY))


def test_fake_source_satisfies_protocol():
    assert isinstance(FakeBlockSource([]), BlockSource)


def test_ranking_order_and_tie_break_unit():
    top = RunningTop(n=3)
    for value, txid in [(5, "c"), (9, "b"), (5, "a"), (1, "z"), (9, "a")]:
        top.add(rank_key(value, txid), txid)
    assert top.ranked() == ["a", "b", "a"]  # (9,a), (9,b), (5,a)


def test_ranking_keeps_highest_values(repo):
    txs = tuple(fx_tx(n, value=n * 100) for n in range(1, 151))
    run(fx_chain([fx_block(0, 60, txs)]), repo)
    assert stored_txids(repo) == sorted(fx_txid(n) for n in range(51, 151))


def test_tie_at_rank_100_broken_by_txid_ascending(repo):
    high = [fx_tx(n, value=1_000_000) for n in range(1, 100)]  # 99 clear winners
    tied = [fx_tx(0, value=5, txid="c" * 64), fx_tx(0, value=5, txid="a" * 64), fx_tx(0, value=5, txid="b" * 64)]
    run(fx_chain([fx_block(0, 60, tuple(high + tied))]), repo)
    ids = stored_txids(repo)
    assert len(ids) == 100 and "a" * 64 in ids and "b" * 64 not in ids and "c" * 64 not in ids


def test_more_than_100_candidates_across_blocks_trimmed_to_100(repo):
    blocks = [fx_block(i, 60 + i, tuple(fx_tx(i * 1000 + n, value=n) for n in range(1, 41))) for i in range(4)]
    report = run(fx_chain(blocks), repo)
    assert report.eligible == 160 and report.stored == 100 and len(stored_txids(repo)) == 100


def test_coinbase_excluded(repo):
    cb = fx_tx(1, ins=(None,), outs=(("fx-miner", 10**12),), coinbase=True)
    normal = fx_tx(2, value=10)
    report = run(fx_chain([fx_block(0, 60, (cb, normal))]), repo)
    assert stored_txids(repo) == [fx_txid(2)] and report.coinbase_excluded == 1


def test_no_address_outputs_ignored_for_ranking_and_storage(repo):
    # Huge OP_RETURN-like output without address must not rank this tx above the other one.
    a = fx_tx(1, outs=((None, 10**12), ("fx-a", 50)))
    b = fx_tx(2, outs=(("fx-b", 100),))
    fillers = [fx_tx(100 + n, value=1_000) for n in range(99)]
    report = run(fx_chain([fx_block(0, 60, (a, b, *fillers))]), repo)
    ids = stored_txids(repo)
    assert fx_txid(2) in ids and fx_txid(1) not in ids  # a ranks by 50, b by 100; 99 fillers beat a
    assert report.outputs_without_address == 1


def test_stored_tx_keeps_only_addressed_outputs(repo):
    run(fx_chain([fx_block(0, 60, (fx_tx(1, outs=((None, 0), ("fx-a", 50), (None, 7))),))]), repo)
    [tx] = repo.get_day_transactions(DAY)
    assert [(o.position, o.address) for o in tx.outputs] == [(1, "fx-a")]


def test_self_loop_dropped_but_other_edge_keeps_tx_eligible():
    assert has_edge(fx_tx(1, ins=("A",), outs=(("A", 900), ("B", 100))))
    assert has_edge(fx_tx(2, ins=("A", "B"), outs=(("A", 900),)))  # B -> A remains
    assert not has_edge(fx_tx(3, ins=("A",), outs=(("A", 900),)))


def test_tx_left_with_no_edges_excluded(repo):
    only_self = fx_tx(1, ins=("A", "A"), outs=(("A", 10**9),))
    normal = fx_tx(2, value=10)
    report = run(fx_chain([fx_block(0, 60, (only_self, normal))]), repo)
    assert stored_txids(repo) == [fx_txid(2)] and report.no_edge_excluded == 1


def test_tx_without_addressed_input_excluded(repo):
    no_in = fx_tx(1, ins=(None,), outs=(("fx-a", 10**9),))
    run(fx_chain([fx_block(0, 60, (no_in, fx_tx(2)))]), repo)
    assert stored_txids(repo) == [fx_txid(2)]


def test_block_outside_day_by_own_timestamp_excluded(repo):
    # The listing claims block +1 is inside the day, but its own timestamp is before midnight.
    late = fx_block(1, -1, (fx_tx(10, value=10**9),))
    chain = fx_chain([fx_block(0, 1, (fx_tx(1),)), late, fx_block(2, 3, (fx_tx(2),))])
    report = run(chain, repo, header_times={late.height: DAY_START + timedelta(minutes=2)})
    assert stored_txids(repo) == sorted([fx_txid(1), fx_txid(2)])
    assert late.height in report.blocks_excluded


def test_in_day_block_beyond_listing_range_found_via_margin(repo):
    # Listing says block +3 is after midnight, but its own timestamp is inside the day.
    chain = fx_chain([fx_block(0, 600, (fx_tx(1),)), fx_block(1, 1400, (fx_tx(2),))], after=8)
    hidden = chain.index(next(b for b in chain if b.height == BASE_HEIGHT + 3))
    chain[hidden] = fx_block(3, 1430, (fx_tx(3),))
    report = run(chain, repo, header_times={BASE_HEIGHT + 3: DAY_START + timedelta(days=1, minutes=5)})
    assert fx_txid(3) in stored_txids(repo)
    assert report.blocks_included == 3


def test_margin_extends_until_outer_margin_blocks_are_outside(repo):
    # Listed in-day range is 0..1, margin 2 -> initial fetch up to +3. Blocks +3 and +5 have their own
    # timestamp inside the day although the listing puts them after it: +5 is only reached by extension.
    day = [fx_block(0, 10, (fx_tx(1),)), fx_block(1, 20, (fx_tx(2),))]
    inside = {3: fx_block(3, 30, (fx_tx(3),)), 5: fx_block(5, 40, (fx_tx(5),))}
    chain = [inside.get(b.height - BASE_HEIGHT, b) for b in fx_chain(day, after=10)]
    late = DAY_START + timedelta(days=2)
    report = run(chain, repo, margin=2, header_times={BASE_HEIGHT + 3: late, BASE_HEIGHT + 5: late})
    assert stored_txids(repo) == sorted(fx_txid(n) for n in (1, 2, 3, 5))
    assert report.height_range == (BASE_HEIGHT - 2, BASE_HEIGHT + 7)
    assert report.blocks_included == 4


def test_mid_day_failure_leaves_previous_data_untouched(repo):
    previous = [fixture_tx(1)]
    repo.replace_day(DAY, previous)
    blocks = fx_chain([fx_block(i, 60 * i + 1, (fx_tx(i + 1),)) for i in range(4)])
    with pytest.raises(SourceError):
        ingest_day(DAY, FakeBlockSource(blocks, fail_at_height=BASE_HEIGHT + 2), repo, now=NOW)
    assert repo.get_day_transactions(DAY) == previous


def test_rerun_replaces(repo):
    run(fx_chain([fx_block(0, 60, (fx_tx(1), fx_tx(2)))]), repo)
    run(fx_chain([fx_block(0, 60, (fx_tx(3),))]), repo)
    assert stored_txids(repo) == [fx_txid(3)]
    assert [d.day for d in repo.list_ingested_days()] == [DAY]


def test_empty_result_refused_and_nothing_stored(repo):
    cb = fx_tx(1, ins=(None,), outs=(("fx-miner", 10**8),), coinbase=True)
    with pytest.raises(NoEligibleTransactionsError):
        run(fx_chain([fx_block(0, 60, (cb,))]), repo)
    assert repo.list_ingested_days() == []


@pytest.mark.parametrize("now", [
    datetime(2026, 10, 9, 23, 59, tzinfo=timezone.utc),   # day not over yet
    datetime(2026, 10, 9, 0, 0, tzinfo=timezone.utc),     # day just started
    datetime(2026, 10, 1, tzinfo=timezone.utc),           # future day
])
def test_incomplete_or_future_day_refused(repo, now):
    with pytest.raises(InvalidTargetDayError):
        ingest_day(DAY, FakeBlockSource(fx_chain([fx_block(0, 60, (fx_tx(1),))])), repo, now=now)


def test_day_ending_exactly_now_accepted(repo):
    ingest_day(DAY, FakeBlockSource(fx_chain([fx_block(0, 60, (fx_tx(1),))])), repo,
               now=datetime(2026, 10, 10, tzinfo=timezone.utc))
    assert stored_txids(repo) == [fx_txid(1)]


def test_amounts_are_integer_satoshis(repo):
    run(fx_chain([fx_block(0, 60, (fx_tx(1, value=123_456_789),))]), repo)
    [tx] = repo.get_day_transactions(DAY)
    assert all(type(x.value_sat) is int for x in tx.inputs + tx.outputs)
    assert tx.outputs[0].value_sat == 123_456_789
