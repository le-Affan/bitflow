"""Response models of the read-only API. All amounts are integer satoshis."""
from datetime import date, datetime

from pydantic import BaseModel

ADDRESS_SCOPE = (
    "These numbers cover only the stored transactions of this day (the displayed view), "
    "not the address's full history."
)


class DayOut(BaseModel):
    date: date
    transaction_count: int
    ingested_at: datetime


class NodeOut(BaseModel):
    address: str


class EdgeOut(BaseModel):
    source: str
    target: str
    tx_count: int


class GraphOut(BaseModel):
    day: date
    transaction_count: int
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    # Only set for a day that was checked and had 0 eligible transactions ("no_eligible_transactions"); omitted for
    # stored days, so their response is unchanged.
    status: str | None = None


class AddressOut(BaseModel):
    day: date
    address: str
    transaction_count: int
    spent_sat: int
    received_sat: int
    scope: str = ADDRESS_SCOPE


class EdgeTransactionOut(BaseModel):
    txid: str
    block_height: int
    block_time: datetime
    amount_to_target_sat: int


class EdgeDetailOut(BaseModel):
    day: date
    source: str
    target: str
    transactions: list[EdgeTransactionOut]


class TxInputOut(BaseModel):
    position: int
    address: str
    value_sat: int


class TxOutputOut(BaseModel):
    position: int
    address: str
    value_sat: int


class TransactionOut(BaseModel):
    day: date
    txid: str
    block_height: int
    block_time: datetime
    inputs: list[TxInputOut]
    outputs: list[TxOutputOut]


class ErrorDetail(BaseModel):
    code: str
    message: str
