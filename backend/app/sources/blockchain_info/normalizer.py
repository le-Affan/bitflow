"""Turns blockchain.info JSON into BitFlow's normalized chain objects.

Response shapes (see docs/data-source-spike.md):
- GET /block-height/{h}?format=json -> {"blocks": [{"height", "hash", "time", "main_chain", "tx": [...]}]}
  tx: {"hash", "inputs": [{"prev_out": {"addr"?, "value", "n", ...}}], "out": [{"addr"?, "value", "n"}]}
- GET /blocks/{ms}?format=json -> [{"height", "hash", "time"}], blocks of the 24 h before {ms} (measured).
Values are integer satoshis. Coinbase inputs have prev_out.n == 0xFFFFFFFF and no addr.
"""
import re
from datetime import datetime, timezone
from typing import Any

from app.domain.chain import BlockHeader, ChainBlock, ChainInput, ChainOutput, ChainTransaction
from app.ingestion.source import SourceError

COINBASE_PREV_N = 0xFFFFFFFF
_TXID = re.compile(r"^[0-9a-f]{64}$")


def _int(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SourceError(f"{what}: expected integer, got {value!r}")
    return value


def _time(value: Any, what: str) -> datetime:
    return datetime.fromtimestamp(_int(value, what), tz=timezone.utc)


def _address(value: Any) -> str | None:
    # blockchain.info exposes at most one address per script ("addr"); anything else counts as no address.
    return value if isinstance(value, str) and value else None


def normalize_headers(payload: Any) -> list[BlockHeader]:
    if not isinstance(payload, list):
        raise SourceError("block listing: expected a list")
    return [BlockHeader(height=_int(b["height"], "height"), time=_time(b["time"], "time")) for b in payload]


def normalize_block(payload: Any, expected_height: int) -> ChainBlock:
    try:
        candidates = [b for b in payload["blocks"] if b.get("main_chain") is True]
    except (KeyError, TypeError, AttributeError) as exc:
        raise SourceError(f"block {expected_height}: unexpected response shape") from exc
    if len(candidates) != 1:
        raise SourceError(f"block {expected_height}: expected 1 main-chain block, got {len(candidates)}")
    b = candidates[0]
    height = _int(b["height"], "height")
    if height != expected_height:
        raise SourceError(f"asked for block {expected_height}, got {height}")
    txs = tuple(_normalize_tx(tx) for tx in b["tx"])
    if "n_tx" in b and _int(b["n_tx"], "n_tx") != len(txs):
        raise SourceError(f"block {height}: n_tx={b['n_tx']} but {len(txs)} transactions in response")
    return ChainBlock(height=height, hash=b["hash"], time=_time(b["time"], "time"), transactions=txs)


def _normalize_tx(tx: dict) -> ChainTransaction:
    txid = tx["hash"]
    if not isinstance(txid, str) or not _TXID.match(txid):
        raise SourceError(f"invalid txid {txid!r}")
    raw_inputs = tx["inputs"]
    is_coinbase = len(raw_inputs) == 1 and (
        raw_inputs[0].get("prev_out") is None or raw_inputs[0]["prev_out"].get("n") == COINBASE_PREV_N
    )
    inputs = []
    for position, raw in enumerate(raw_inputs):
        prev = raw.get("prev_out")
        if prev is None:
            if not is_coinbase:
                raise SourceError(f"tx {txid}: input {position} has no prev_out")
            inputs.append(ChainInput(position=position, address=None, value_sat=0))
            continue
        inputs.append(
            ChainInput(position=position, address=_address(prev.get("addr")), value_sat=_int(prev["value"], "value"))
        )
    outputs = tuple(
        ChainOutput(position=_int(o["n"], "n"), address=_address(o.get("addr")), value_sat=_int(o["value"], "value"))
        for o in tx["out"]
    )
    return ChainTransaction(txid=txid, is_coinbase=is_coinbase, inputs=tuple(inputs), outputs=outputs)
