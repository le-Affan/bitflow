"""Ingest one UTC day: find its blocks, rank eligible transactions, store the top 100 atomically."""
import heapq
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from app.domain.chain import ChainBlock, ChainOutput, ChainTransaction
from app.domain.models import IngestedDay, Transaction, TxInput, TxOutput
from app.ingestion.source import BlockSource, SourceStats
from app.repository import DayRepository

log = logging.getLogger("bitflow.ingestion")

MAX_TRANSACTIONS_PER_DAY = 100
DEFAULT_MARGIN_BLOCKS = 3


class IngestionError(Exception):
    """The day could not be ingested. Nothing was stored."""


class InvalidTargetDayError(IngestionError):
    pass


class NoEligibleTransactionsError(IngestionError):
    pass


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def validate_target_day(day: date, now: datetime) -> None:
    _, end = day_bounds(day)
    if end > now:
        raise InvalidTargetDayError(f"{day} is not a complete UTC day in the past (now: {now.isoformat()})")


def outward_outputs(tx: ChainTransaction) -> list[ChainOutput]:
    """Outputs with a standard address that is not one of the transaction's own input addresses.

    These are the outputs that move money to another address. Change sent back to an input address is excluded;
    change sent to a brand-new address cannot be told apart from a payment (known limitation, no clustering).
    """
    in_addrs = {i.address for i in tx.inputs if i.address}
    return [o for o in tx.outputs if o.address and o.address not in in_addrs]


def ranking_value(tx: ChainTransaction) -> int | None:
    """Largest outward output (see `outward_outputs`), in satoshis. None if there is none."""
    values = [o.value_sat for o in outward_outputs(tx)]
    return max(values) if values else None


def rank_key(value_sat: int, txid: str) -> tuple[int, str]:
    """Sort key: higher value first, ties by txid ascending."""
    return (-value_sat, txid)


class RunningTop:
    """Keeps only the best `n` candidates seen so far."""

    def __init__(self, n: int = MAX_TRANSACTIONS_PER_DAY) -> None:
        self.n = n
        # Min-heap whose root is the worst kept candidate.
        self._heap: list[tuple["_Worst", Transaction]] = []

    def would_accept(self, key: tuple[int, str]) -> bool:
        return len(self._heap) < self.n or key < self._heap[0][0].key

    def add(self, key: tuple[int, str], tx: Transaction) -> None:
        item = (_Worst(key), tx)
        if len(self._heap) < self.n:
            heapq.heappush(self._heap, item)
        elif key < self._heap[0][0].key:
            heapq.heapreplace(self._heap, item)

    def ranked(self) -> list[Transaction]:
        return [tx for w, tx in sorted(self._heap, key=lambda item: item[0].key)]

    def __len__(self) -> int:
        return len(self._heap)


@dataclass(frozen=True)
class _Worst:
    """Heap wrapper: the entry with the worst rank key sorts first."""

    key: tuple[int, str]

    def __lt__(self, other: "_Worst") -> bool:
        return self.key > other.key


@dataclass
class IngestionReport:
    day: date
    listed_in_day: int = 0
    height_range: tuple[int, int] | None = None
    blocks_fetched: int = 0
    blocks_included: int = 0
    margin_blocks_fetched: int = 0
    blocks_excluded: list[int] = field(default_factory=list)  # fetched, own timestamp outside the day
    transactions_seen: int = 0
    coinbase_excluded: int = 0
    no_addressed_input_excluded: int = 0
    no_outward_output_excluded: int = 0  # no addressed output to an address outside the tx's inputs
    eligible: int = 0
    inputs_without_address: int = 0
    outputs_without_address: int = 0
    stored: int = 0
    source_stats: SourceStats | None = None
    elapsed_s: float = 0.0
    stored_day: IngestedDay | None = None


def _to_domain(tx: ChainTransaction, block: ChainBlock) -> Transaction:
    return Transaction(
        txid=tx.txid,
        block_height=block.height,
        block_time=block.time,
        inputs=tuple(TxInput(i.position, i.address, i.value_sat) for i in tx.inputs if i.address),
        outputs=tuple(TxOutput(o.position, o.address, o.value_sat) for o in tx.outputs if o.address),
    )


def _process_block(block: ChainBlock, top: RunningTop, report: IngestionReport) -> None:
    for tx in block.transactions:
        report.transactions_seen += 1
        report.inputs_without_address += sum(1 for i in tx.inputs if not i.address)
        report.outputs_without_address += sum(1 for o in tx.outputs if not o.address)
        if tx.is_coinbase:
            report.coinbase_excluded += 1
            continue
        if not any(i.address for i in tx.inputs):
            report.no_addressed_input_excluded += 1
            continue
        value = ranking_value(tx)
        if value is None:
            report.no_outward_output_excluded += 1
            continue
        report.eligible += 1
        key = rank_key(value, tx.txid)
        if top.would_accept(key):
            top.add(key, _to_domain(tx, block))


def ingest_day(
    day: date,
    source: BlockSource,
    repository: DayRepository,
    *,
    margin: int = DEFAULT_MARGIN_BLOCKS,
    now: datetime | None = None,
) -> IngestionReport:
    """Ingest `day` (UTC). Stores the day's top 100 eligible transactions, or raises and stores nothing."""
    started = time.monotonic()
    now = now or datetime.now(timezone.utc)
    validate_target_day(day, now)
    start, end = day_bounds(day)
    report = IngestionReport(day=day)

    headers = source.list_block_headers(start, end)
    in_day = [h.height for h in headers if start <= h.time < end]
    report.listed_in_day = len(in_day)
    if not in_day:
        raise IngestionError(f"source listed no blocks with a timestamp inside {day}")
    lo, hi = min(in_day), max(in_day)
    log.info("day %s: source lists %d blocks in day, heights %d-%d; margin %d", day, len(in_day), lo, hi, margin)

    top = RunningTop()
    inside: dict[int, bool] = {}  # height -> own timestamp inside the day

    def fetch(height: int) -> None:
        block = source.get_block(height)
        if block.height != height:
            raise IngestionError(f"asked for block {height}, got {block.height}")
        inside[height] = start <= block.time < end
        report.blocks_fetched += 1
        if inside[height]:
            report.blocks_included += 1
            _process_block(block, top, report)
        else:
            report.blocks_excluded.append(height)
        stats = source.stats()
        log.info(
            "block %d (%d fetched) in_day=%s txs=%d requests=%d retries=%d elapsed=%.1fs",
            height, report.blocks_fetched, inside[height], len(block.transactions),
            stats.requests, stats.retries, time.monotonic() - started,
        )

    for height in range(lo - margin, hi + margin + 1):
        fetch(height)
    # Extend at either edge until the outermost `margin` blocks there are all outside the day.
    low = lo - margin
    while any(inside[h] for h in range(low, low + margin)):
        low -= 1
        fetch(low)
    high = hi + margin
    while any(inside[h] for h in range(high - margin + 1, high + 1)):
        high += 1
        fetch(high)

    report.height_range = (low, high)
    report.margin_blocks_fetched = (lo - low) + (high - hi)
    if report.blocks_included != report.listed_in_day:
        log.warning("source listed %d blocks in day but %d fetched blocks have their own timestamp in day",
                    report.listed_in_day, report.blocks_included)

    ranked = top.ranked()
    if not ranked:
        raise NoEligibleTransactionsError(f"no eligible transactions in {day}; refusing to store an empty day")
    if len(ranked) > MAX_TRANSACTIONS_PER_DAY:  # RunningTop guarantees this; keep the rule explicit.
        raise IngestionError("more than 100 transactions selected")

    report.stored_day = repository.replace_day(day, ranked)
    report.stored = len(ranked)
    report.source_stats = source.stats()
    report.elapsed_s = round(time.monotonic() - started, 1)
    return report
