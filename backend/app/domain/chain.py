"""Normalized chain data as delivered by any BlockSource. Independent of any external API.

Addresses are None when the source shows no single standard address (OP_RETURN, non-standard scripts,
outputs with several or no addresses). All amounts are integer satoshis.
"""
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class BlockHeader:
    height: int
    time: datetime  # timezone-aware, UTC


@dataclass(frozen=True)
class ChainInput:
    position: int
    address: str | None
    value_sat: int


@dataclass(frozen=True)
class ChainOutput:
    position: int
    address: str | None
    value_sat: int


@dataclass(frozen=True)
class ChainTransaction:
    txid: str
    is_coinbase: bool
    inputs: tuple[ChainInput, ...]
    outputs: tuple[ChainOutput, ...]


@dataclass(frozen=True)
class ChainBlock:
    height: int
    hash: str
    time: datetime  # the block's own timestamp, timezone-aware, UTC
    transactions: tuple[ChainTransaction, ...]
