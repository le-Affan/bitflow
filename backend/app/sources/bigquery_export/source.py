"""Reads a BigQuery history export and serves it as a BlockSource for app.ingestion.core.

The export is written by scripts/bigquery_history/load.py with the bq CLI (no subprocess or HTTP here):

- blocks.csv:     number,hash,timestamp_unix
  every block of the exported period plus a margin of days around it (for core.py's boundary handling).
- candidates.csv: day,rank,txid,block_number,block_time_unix,kind,position,address,value_sat
  for each UTC day, the top candidates under BitFlow's ranking rule as computed in BigQuery (more than 100, so
  core.py re-ranks and picks the final 100 itself), one row per input/output that has exactly one address.
  kind is "in" or "out"; values are integer satoshis.

Candidate transactions are never coinbase (excluded in the query). Inputs/outputs without exactly one address are
not exported; core.py ignores them for ranking and storage anyway.
"""
import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.domain.chain import BlockHeader, ChainBlock, ChainInput, ChainOutput, ChainTransaction
from app.ingestion.source import SourceError, SourceStats

_TXID = re.compile(r"^[0-9a-f]{64}$")
BLOCK_COLUMNS = ["number", "hash", "timestamp_unix"]
CANDIDATE_COLUMNS = ["day", "rank", "txid", "block_number", "block_time_unix", "kind", "position", "address", "value_sat"]


def _int(value: str, what: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise SourceError(f"{what}: expected integer, got {value!r}") from exc


def _time(value: str, what: str) -> datetime:
    return datetime.fromtimestamp(_int(value, what), tz=timezone.utc)


@dataclass(frozen=True)
class _Block:
    hash: str
    time: datetime


@dataclass
class Export:
    blocks: dict[int, _Block]
    transactions_by_block: dict[int, list[ChainTransaction]]


def _rows(path: Path, columns: list[str]):
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != columns:
            raise SourceError(f"{path.name}: expected columns {columns}, got {reader.fieldnames}")
        yield from reader


def load_export(blocks_csv: Path, candidates_csv: Path) -> Export:
    blocks: dict[int, _Block] = {}
    for r in _rows(blocks_csv, BLOCK_COLUMNS):
        blocks[_int(r["number"], "number")] = _Block(hash=r["hash"], time=_time(r["timestamp_unix"], "timestamp_unix"))

    tx_block: dict[str, int] = {}
    ins: dict[str, list[ChainInput]] = defaultdict(list)
    outs: dict[str, list[ChainOutput]] = defaultdict(list)
    for r in _rows(candidates_csv, CANDIDATE_COLUMNS):
        txid = r["txid"]
        if not _TXID.match(txid):
            raise SourceError(f"invalid txid {txid!r}")
        height = _int(r["block_number"], "block_number")
        block = blocks.get(height)
        if block is None:
            raise SourceError(f"tx {txid}: block {height} missing from blocks.csv")
        if _time(r["block_time_unix"], "block_time_unix") != block.time:
            raise SourceError(f"tx {txid}: block time differs from blocks.csv for block {height}")
        if tx_block.setdefault(txid, height) != height:
            raise SourceError(f"tx {txid}: appears in two blocks")
        if not r["address"]:
            raise SourceError(f"tx {txid}: empty address")
        position, value = _int(r["position"], "position"), _int(r["value_sat"], "value_sat")
        if r["kind"] == "in":
            ins[txid].append(ChainInput(position=position, address=r["address"], value_sat=value))
        elif r["kind"] == "out":
            outs[txid].append(ChainOutput(position=position, address=r["address"], value_sat=value))
        else:
            raise SourceError(f"tx {txid}: unknown kind {r['kind']!r}")

    by_block: dict[int, list[ChainTransaction]] = defaultdict(list)
    for txid, height in tx_block.items():
        by_block[height].append(ChainTransaction(
            txid=txid,
            is_coinbase=False,
            inputs=tuple(sorted(ins[txid], key=lambda i: i.position)),
            outputs=tuple(sorted(outs[txid], key=lambda o: o.position)),
        ))
    return Export(blocks=blocks, transactions_by_block=dict(by_block))


class BigQueryExportSource:
    """BlockSource over a loaded export. Blocks without exported candidates have no transactions."""

    def __init__(self, export: Export) -> None:
        self._export = export
        self._stats = SourceStats()

    @classmethod
    def from_files(cls, blocks_csv: Path, candidates_csv: Path) -> "BigQueryExportSource":
        return cls(load_export(blocks_csv, candidates_csv))

    def list_block_headers(self, start: datetime, end: datetime) -> list[BlockHeader]:
        return [BlockHeader(height=h, time=b.time) for h, b in sorted(self._export.blocks.items()) if start <= b.time < end]

    def get_block(self, height: int) -> ChainBlock:
        block = self._export.blocks.get(height)
        if block is None:
            raise SourceError(f"block {height} is not in the export")
        self._stats.requests += 1
        return ChainBlock(height=height, hash=block.hash, time=block.time,
                          transactions=tuple(self._export.transactions_by_block.get(height, ())))

    def stats(self) -> SourceStats:
        return self._stats
