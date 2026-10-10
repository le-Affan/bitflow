"""Read-only API for the visualiser. Depends only on the DayRepository interface and the pure graph module."""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.schemas import (
    AddressOut,
    DayOut,
    EdgeDetailOut,
    EdgeOut,
    EdgeTransactionOut,
    GraphOut,
    NodeOut,
    TransactionOut,
    TxInputOut,
    TxOutputOut,
)
from app.domain.graph import address_summary, build_graph, edge_transactions
from app.domain.models import IngestedDay, Transaction
from app.repository import DayRepository

router = APIRouter(prefix="/api")


def get_repository(request: Request) -> DayRepository:
    return request.app.state.repository_provider()


Repo = Annotated[DayRepository, Depends(get_repository)]
DayParam = Annotated[date, Query(description="UTC day, YYYY-MM-DD")]


def _not_found(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": code, "message": message})


def _resolve_day(repo: DayRepository, day: date | None) -> IngestedDay:
    if day is None:
        latest = repo.get_latest_day()
        if latest is None:
            raise _not_found("no_ingested_days", "No day has been ingested yet.")
        return latest
    for d in repo.list_ingested_days():
        if d.day == day:
            return d
    raise _not_found("day_not_ingested", f"Day {day.isoformat()} has not been ingested.")


def _day_transactions(repo: DayRepository, day: date | None) -> tuple[IngestedDay, list[Transaction]]:
    ingested = _resolve_day(repo, day)
    return ingested, repo.get_day_transactions(ingested.day)


@router.get("/days", response_model=list[DayOut])
def list_days(repo: Repo) -> list[DayOut]:
    days = sorted(repo.list_ingested_days(), key=lambda d: d.day, reverse=True)
    return [DayOut(date=d.day, transaction_count=d.transaction_count, ingested_at=d.ingested_at) for d in days]


@router.get("/graph", response_model=GraphOut)
def get_graph(repo: Repo, day: Annotated[date | None, Query(description="UTC day; latest if omitted")] = None):
    ingested, txs = _day_transactions(repo, day)
    graph = build_graph(txs)
    return GraphOut(
        day=ingested.day,
        transaction_count=len(txs),
        nodes=[NodeOut(address=a) for a in graph.nodes],
        edges=[EdgeOut(source=e.source, target=e.target, tx_count=e.tx_count) for e in graph.edges],
    )


@router.get("/addresses/{address}", response_model=AddressOut)
def get_address(address: str, repo: Repo, day: DayParam):
    ingested, txs = _day_transactions(repo, day)
    summary = address_summary(txs, address)
    if summary is None:
        raise _not_found("address_not_in_graph", f"Address {address} is not in the graph of {ingested.day}.")
    return AddressOut(
        day=ingested.day,
        address=summary.address,
        transaction_count=summary.transaction_count,
        spent_sat=summary.spent_sat,
        received_sat=summary.received_sat,
    )


@router.get("/edges", response_model=EdgeDetailOut)
def get_edge(
    repo: Repo,
    day: DayParam,
    source: Annotated[str, Query(min_length=1)],
    target: Annotated[str, Query(min_length=1)],
):
    ingested, txs = _day_transactions(repo, day)
    rows = edge_transactions(txs, source, target)
    if not rows:
        raise _not_found("edge_not_found", f"No edge {source} -> {target} on {ingested.day}.")
    return EdgeDetailOut(
        day=ingested.day,
        source=source,
        target=target,
        transactions=[
            EdgeTransactionOut(
                txid=r.txid, block_height=r.block_height, block_time=r.block_time,
                amount_to_target_sat=r.amount_to_target_sat,
            )
            for r in rows
        ],
    )


@router.get("/transactions/{txid}", response_model=TransactionOut)
def get_transaction(txid: str, repo: Repo, day: DayParam):
    ingested, txs = _day_transactions(repo, day)
    tx = next((t for t in txs if t.txid == txid), None)
    if tx is None:
        raise _not_found("transaction_not_found", f"Transaction {txid} is not stored for {ingested.day}.")
    return TransactionOut(
        day=ingested.day,
        txid=tx.txid,
        block_height=tx.block_height,
        block_time=tx.block_time,
        inputs=[TxInputOut(position=i.position, address=i.address, value_sat=i.value_sat) for i in tx.inputs],
        outputs=[TxOutputOut(position=o.position, address=o.address, value_sat=o.value_sat) for o in tx.outputs],
    )
