"""TEST FIXTURES ONLY. A fake BlockSource and synthetic blocks/transactions for ingestion tests.

None of these txids, addresses, heights or amounts are real blockchain data. Do not import this module outside tests.
"""
from datetime import datetime, timedelta, timezone

from app.domain.chain import BlockHeader, ChainBlock, ChainInput, ChainOutput, ChainTransaction
from app.ingestion.source import SourceError, SourceStats

DAY_START = datetime(2026, 10, 9, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
BASE_HEIGHT = 800_000


def fx_txid(n: int) -> str:
    return f"{n:064x}"


def fx_tx(
    n: int,
    value: int = 1_000,
    *,
    ins: tuple[str | None, ...] = ("fx-in",),
    outs: tuple[tuple[str | None, int], ...] | None = None,
    coinbase: bool = False,
    txid: str | None = None,
) -> ChainTransaction:
    """Synthetic tx. Default: one input from 'fx-in-<n>' paying `value` sat to 'fx-out-<n>'."""
    ins = tuple(f"{a}-{n}" if a == "fx-in" else a for a in ins)
    outs = outs if outs is not None else ((f"fx-out-{n}", value),)
    return ChainTransaction(
        txid=txid or fx_txid(n),
        is_coinbase=coinbase,
        inputs=tuple(ChainInput(position=i, address=a, value_sat=10_000_000) for i, a in enumerate(ins)),
        outputs=tuple(ChainOutput(position=i, address=a, value_sat=v) for i, (a, v) in enumerate(outs)),
    )


def fx_block(offset: int, minutes: float, txs: tuple[ChainTransaction, ...] = ()) -> ChainBlock:
    """Synthetic block at BASE_HEIGHT + offset with own time DAY_START + `minutes` (may be outside the day)."""
    return ChainBlock(
        height=BASE_HEIGHT + offset,
        hash=f"{BASE_HEIGHT + offset:064x}",
        time=DAY_START + timedelta(minutes=minutes),
        transactions=txs,
    )


def fx_chain(day_blocks: list[ChainBlock], before: int = 5, after: int = 5) -> list[ChainBlock]:
    """Surround the given in-day blocks (consecutive offsets from 0) with empty out-of-day neighbours."""
    n = len(day_blocks)
    pre = [fx_block(-i, -10.0 * i) for i in range(before, 0, -1)]
    post = [fx_block(n - 1 + i, 24 * 60 + 10.0 * i) for i in range(1, after + 1)]
    return pre + day_blocks + post


class FakeBlockSource:
    """TEST FIXTURE. Serves blocks from memory; can fail at a given height."""

    def __init__(self, blocks: list[ChainBlock], *, header_times: dict[int, datetime] | None = None,
                 fail_at_height: int | None = None) -> None:
        self._blocks = {b.height: b for b in blocks}
        self._header_times = header_times or {}
        self._fail_at = fail_at_height
        self._stats = SourceStats()
        self.fetched: list[int] = []

    def list_block_headers(self, start, end):
        self._stats.requests += 1
        return [BlockHeader(height=h, time=self._header_times.get(h, b.time)) for h, b in sorted(self._blocks.items())]

    def get_block(self, height):
        self._stats.requests += 1
        if height == self._fail_at:
            raise SourceError(f"fixture failure at block {height}")
        if height not in self._blocks:
            raise SourceError(f"fixture has no block {height}")
        self.fetched.append(height)
        return self._blocks[height]

    def stats(self):
        return self._stats
