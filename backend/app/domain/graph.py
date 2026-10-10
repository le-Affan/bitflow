"""Address graph built from a day's stored transactions. Pure functions: no DB, no HTTP.

Rules (docs/BitFlow_PRD.md, MVP scope update):
- every input address links to every output address of the same transaction;
- a pair whose source equals its target is dropped;
- repeated (source, target) pairs across transactions aggregate into one edge;
- nodes are the distinct addresses that appear in at least one edge.

Nothing here depends on how the transactions were ranked. All amounts are integer satoshis.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from app.domain.models import Transaction


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    txids: tuple[str, ...]  # distinct transactions behind this edge, sorted

    @property
    def tx_count(self) -> int:
        return len(self.txids)


@dataclass(frozen=True)
class Graph:
    nodes: tuple[str, ...]  # sorted addresses
    edges: tuple[Edge, ...]  # sorted by (source, target)


@dataclass(frozen=True)
class AddressSummary:
    address: str
    transaction_count: int  # stored transactions the address appears in (as input or output)
    spent_sat: int  # sum of its input values
    received_sat: int  # sum of its output values


@dataclass(frozen=True)
class EdgeTransaction:
    txid: str
    block_height: int
    block_time: datetime
    amount_to_target_sat: int  # sum of this transaction's outputs paid to the edge's target


def transaction_pairs(tx: Transaction) -> set[tuple[str, str]]:
    """Distinct (source, target) address pairs of one transaction, self-loops dropped."""
    sources = {i.address for i in tx.inputs}
    targets = {o.address for o in tx.outputs}
    return {(s, t) for s in sources for t in targets if s != t}


def build_graph(transactions: Iterable[Transaction]) -> Graph:
    txids_by_pair: dict[tuple[str, str], set[str]] = {}
    for tx in transactions:
        for pair in transaction_pairs(tx):
            txids_by_pair.setdefault(pair, set()).add(tx.txid)
    edges = tuple(
        Edge(source=s, target=t, txids=tuple(sorted(txids))) for (s, t), txids in sorted(txids_by_pair.items())
    )
    nodes = tuple(sorted({a for e in edges for a in (e.source, e.target)}))
    return Graph(nodes=nodes, edges=edges)


def address_summary(transactions: Iterable[Transaction], address: str) -> AddressSummary | None:
    """Totals for `address` over the given transactions. None if it is not a node of their graph."""
    transactions = list(transactions)
    if address not in build_graph(transactions).nodes:
        return None
    count = spent = received = 0
    for tx in transactions:
        tx_spent = sum(i.value_sat for i in tx.inputs if i.address == address)
        tx_received = sum(o.value_sat for o in tx.outputs if o.address == address)
        if any(i.address == address for i in tx.inputs) or any(o.address == address for o in tx.outputs):
            count += 1
        spent += tx_spent
        received += tx_received
    return AddressSummary(address=address, transaction_count=count, spent_sat=spent, received_sat=received)


def edge_transactions(transactions: Iterable[Transaction], source: str, target: str) -> list[EdgeTransaction]:
    """Transactions behind the aggregated edge source -> target, by block height then txid. Empty if no edge."""
    result = [
        EdgeTransaction(
            txid=tx.txid,
            block_height=tx.block_height,
            block_time=tx.block_time,
            amount_to_target_sat=sum(o.value_sat for o in tx.outputs if o.address == target),
        )
        for tx in transactions
        if (source, target) in transaction_pairs(tx)
    ]
    return sorted(result, key=lambda e: (e.block_height, e.txid))
