"""BitFlow's internal data model. Independent of any external API and of the database.

All amounts are integer satoshis.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum


class DayStatus(str, Enum):
    INGESTED = "ingested"


@dataclass(frozen=True)
class TxInput:
    position: int  # index of the input in the original transaction
    address: str
    value_sat: int


@dataclass(frozen=True)
class TxOutput:
    position: int  # index of the output in the original transaction
    address: str
    value_sat: int


@dataclass(frozen=True)
class Transaction:
    txid: str
    block_height: int
    block_time: datetime  # timezone-aware, UTC
    inputs: tuple[TxInput, ...] = field(default_factory=tuple)
    outputs: tuple[TxOutput, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class IngestedDay:
    day: date  # UTC calendar day
    status: DayStatus
    ingested_at: datetime  # timezone-aware, UTC
    transaction_count: int
