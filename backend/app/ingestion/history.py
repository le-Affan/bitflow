"""One-time loading of many past days through the normal ingestion path (core.ingest_day).

Resumable and duplicate-free: days that are already ingested are skipped, never replaced, so re-running a load
(or overlapping it with days owned by another source) changes nothing that is already stored.
"""
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Literal

from app.ingestion.core import IngestionError, NoEligibleTransactionsError, ingest_day
from app.ingestion.source import BlockSource, SourceError
from app.repository import DayRepository

Status = Literal["loaded", "skipped", "empty", "failed"]


@dataclass
class DayOutcome:
    day: date
    status: Status  # skipped = already stored; empty = no eligible transactions (or no blocks); not stored
    transactions: int = 0
    inputs: int = 0
    outputs: int = 0
    detail: str = ""


def load_days(
    days: Iterable[date],
    source: BlockSource,
    repository: DayRepository,
    *,
    before: date,
    now: datetime | None = None,
) -> list[DayOutcome]:
    """Ingest each day that is not stored yet. Refuses any day on or after `before` (owned by another source)."""
    days = sorted(set(days))
    late = [d for d in days if d >= before]
    if late:
        raise ValueError(f"refusing to load {len(late)} day(s) on or after {before}: {late[0]} ...")
    stored = {d.day for d in repository.list_ingested_days()}
    outcomes: list[DayOutcome] = []
    for day in days:
        if day in stored:
            outcomes.append(DayOutcome(day, "skipped"))
            continue
        try:
            report = ingest_day(day, source, repository, now=now)
        except NoEligibleTransactionsError as exc:
            outcomes.append(DayOutcome(day, "empty", detail=str(exc)))
            continue
        except IngestionError as exc:
            if "listed no blocks" in str(exc):
                outcomes.append(DayOutcome(day, "empty", detail=str(exc)))
            else:
                outcomes.append(DayOutcome(day, "failed", detail=str(exc)))
            continue
        except SourceError as exc:
            outcomes.append(DayOutcome(day, "failed", detail=str(exc)))
            continue
        txs = repository.get_day_transactions(day)
        outcomes.append(DayOutcome(
            day, "loaded", transactions=report.stored,
            inputs=sum(len(t.inputs) for t in txs), outputs=sum(len(t.outputs) for t in txs),
        ))
    return outcomes
