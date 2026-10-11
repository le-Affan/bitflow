"""Read-only API for the visualiser. Depends only on the DayRepository interface and the pure graph module."""
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.schemas import (
    ADDRESS_SCOPE,
    RANGE_ADDRESS_SCOPE,
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

TOP_N = 100  # transactions shown for a range, like a single day


def get_repository(request: Request) -> DayRepository:
    return request.app.state.repository_provider()


Repo = Annotated[DayRepository, Depends(get_repository)]
DayParam = Annotated[date | None, Query(description="UTC day, YYYY-MM-DD (or use start and end)")]
StartParam = Annotated[date | None, Query(description="First UTC day of a range, inclusive")]
EndParam = Annotated[date | None, Query(description="Last UTC day of a range, inclusive")]


def _not_found(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": code, "message": message})


def _invalid(field: str, message: str) -> HTTPException:
    # Same shape as FastAPI's own 422 responses.
    return HTTPException(status_code=422, detail=[{"loc": ["query", field], "msg": message, "type": "value_error"}])


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


EMPTY_DAY_STATUS = "no_eligible_transactions"


def _empty_day(repo: DayRepository, day: date | None) -> date | None:
    """`day` if it is not stored but was checked and had 0 eligible transactions, else None."""
    if day is None or any(d.day == day for d in repo.list_ingested_days()):
        return None
    return day if repo.is_day_empty(day) else None


@dataclass(frozen=True)
class _View:
    """What a graph request shows: one day or a range of days, and its transactions."""

    day: date | None
    start: date | None
    end: date | None
    transactions: list[Transaction]
    empty: bool = False  # checked, 0 eligible transactions

    @property
    def label(self) -> str:
        return self.day.isoformat() if self.day else f"{self.start.isoformat()} to {self.end.isoformat()}"

    def ids(self) -> dict:
        return {"day": self.day, "start": self.start, "end": self.end}


def _view(repo: DayRepository, day: date | None, start: date | None, end: date | None,
          *, day_required: bool) -> _View:
    if start is None and end is None:
        if day is None and day_required:
            raise _invalid("day", "Field required (day, or start and end)")
        empty = _empty_day(repo, day)
        if empty:
            return _View(day=empty, start=None, end=None, transactions=[], empty=True)
        ingested = _resolve_day(repo, day)
        return _View(day=ingested.day, start=None, end=None, transactions=repo.get_day_transactions(ingested.day))
    if day is not None:
        raise _invalid("day", "Use either day or start and end, not both")
    if start is None or end is None:
        raise _invalid("start" if start is None else "end", "start and end are both required for a range")
    if start > end:
        raise _invalid("end", "end must not be before start")
    today = datetime.now(timezone.utc).date()
    if end > today:
        raise _invalid("end", f"end must not be after today ({today.isoformat()}, UTC)")
    if not any(start <= d.day <= end for d in repo.list_ingested_days()):
        # Nothing stored in the range: the same states as a single day.
        checked = {d for d in repo.list_empty_days() if start <= d <= end}
        if len(checked) == (end - start).days + 1:
            return _View(day=None, start=start, end=end, transactions=[], empty=True)
        raise _not_found("day_not_ingested", f"No day from {start.isoformat()} to {end.isoformat()} has been ingested.")
    return _View(day=None, start=start, end=end, transactions=repo.get_range_transactions(start, end, TOP_N))


def _empty_view_not_found(kind: str, what: str, view: _View) -> HTTPException:
    reason = "that day had" if view.day else "the days of that range had"
    return _not_found(kind, f"{what} on {view.label}: {reason} no eligible transactions.")


@router.get("/days", response_model=list[DayOut])
def list_days(repo: Repo) -> list[DayOut]:
    days = sorted(repo.list_ingested_days(), key=lambda d: d.day, reverse=True)
    return [DayOut(date=d.day, transaction_count=d.transaction_count, ingested_at=d.ingested_at) for d in days]


@router.get("/graph", response_model=GraphOut, response_model_exclude_none=True)
def get_graph(
    repo: Repo,
    day: Annotated[date | None, Query(description="UTC day; latest if omitted")] = None,
    start: StartParam = None,
    end: EndParam = None,
):
    view = _view(repo, day, start, end, day_required=False)
    if view.empty:
        return GraphOut(**view.ids(), transaction_count=0, nodes=[], edges=[], status=EMPTY_DAY_STATUS)
    txs = view.transactions
    graph = build_graph(txs)
    return GraphOut(
        **view.ids(),
        transaction_count=len(txs),
        nodes=[NodeOut(address=a) for a in graph.nodes],
        edges=[EdgeOut(source=e.source, target=e.target, tx_count=e.tx_count) for e in graph.edges],
    )


@router.get("/addresses/{address}", response_model=AddressOut, response_model_exclude_none=True)
def get_address(address: str, repo: Repo, day: DayParam = None, start: StartParam = None, end: EndParam = None):
    view = _view(repo, day, start, end, day_required=True)
    if view.empty:
        raise _empty_view_not_found("address_not_in_graph", f"Address {address} is not in the graph", view)
    summary = address_summary(view.transactions, address)
    if summary is None:
        raise _not_found("address_not_in_graph", f"Address {address} is not in the graph of {view.label}.")
    return AddressOut(
        **view.ids(),
        scope=ADDRESS_SCOPE if view.day else RANGE_ADDRESS_SCOPE,
        address=summary.address,
        transaction_count=summary.transaction_count,
        spent_sat=summary.spent_sat,
        received_sat=summary.received_sat,
    )


@router.get("/edges", response_model=EdgeDetailOut, response_model_exclude_none=True)
def get_edge(
    repo: Repo,
    source: Annotated[str, Query(min_length=1)],
    target: Annotated[str, Query(min_length=1)],
    day: DayParam = None,
    start: StartParam = None,
    end: EndParam = None,
):
    view = _view(repo, day, start, end, day_required=True)
    if view.empty:
        raise _empty_view_not_found("edge_not_found", f"No edge {source} -> {target}", view)
    rows = edge_transactions(view.transactions, source, target)
    if not rows:
        raise _not_found("edge_not_found", f"No edge {source} -> {target} on {view.label}.")
    return EdgeDetailOut(
        **view.ids(),
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


@router.get("/transactions/{txid}", response_model=TransactionOut, response_model_exclude_none=True)
def get_transaction(txid: str, repo: Repo, day: DayParam = None, start: StartParam = None, end: EndParam = None):
    view = _view(repo, day, start, end, day_required=True)
    if view.empty:
        raise _empty_view_not_found("transaction_not_found", f"Transaction {txid} is not stored", view)
    tx = next((t for t in view.transactions if t.txid == txid), None)
    if tx is None:
        raise _not_found("transaction_not_found", f"Transaction {txid} is not stored for {view.label}.")
    return TransactionOut(
        **view.ids(),
        txid=tx.txid,
        block_height=tx.block_height,
        block_time=tx.block_time,
        inputs=[TxInputOut(position=i.position, address=i.address, value_sat=i.value_sat) for i in tx.inputs],
        outputs=[TxOutputOut(position=o.position, address=o.address, value_sat=o.value_sat) for o in tx.outputs],
    )
