"""Catch-up: ingest every missing complete UTC day after the newest known day, oldest first, up to yesterday.

"Known" = stored, or checked with 0 eligible transactions. Each day goes through core.ingest_day (all-or-nothing).
The run stops at the first failed day, so the next run retries from there. Days before FIRST_DAILY_DAY are never
touched: they belong to the one-time history load (docs/BitFlow_PRD.md, MVP scope update).
"""
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Literal

from app.ingestion.core import DEFAULT_MARGIN_BLOCKS, IngestionError, NoEligibleTransactionsError, ingest_day
from app.ingestion.source import BlockSource, RateLimitedError, SourceError
from app.repository import DayRepository

log = logging.getLogger("bitflow.ingestion")

FIRST_DAILY_DAY = date(2026, 10, 9)  # first day owned by the daily ingestion; earlier days are history

Status = Literal["stored", "empty", "failed"]


@dataclass
class CatchUpDay:
    day: date
    status: Status
    transactions: int = 0
    requests: int = 0
    megabytes: float = 0.0  # downloaded from the source for this day
    seconds: float = 0.0
    detail: str = ""


@dataclass
class CatchUpResult:
    days: list[CatchUpDay] = field(default_factory=list)
    rate_limited: bool = False
    seconds: float = 0.0

    @property
    def failed(self) -> bool:
        return any(d.status == "failed" for d in self.days)


def missing_days(repository: DayRepository, now: datetime) -> list[date]:
    """Complete UTC days after the newest stored or checked-empty day, up to yesterday, never before FIRST_DAILY_DAY."""
    known = [d.day for d in repository.list_ingested_days()] + repository.list_empty_days()
    first = max([FIRST_DAILY_DAY, *(d + timedelta(days=1) for d in known)])
    yesterday = now.astimezone(timezone.utc).date() - timedelta(days=1)
    return [first + timedelta(days=i) for i in range((yesterday - first).days + 1)]


def catch_up(
    source: BlockSource,
    repository: DayRepository,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    margin: int = DEFAULT_MARGIN_BLOCKS,
) -> CatchUpResult:
    started = time.monotonic()
    result = CatchUpResult()
    days = missing_days(repository, now())
    log.info("catch-up: %d missing day(s)%s", len(days), f": {days[0]} .. {days[-1]}" if days else "")
    for day in days:
        t0 = time.monotonic()
        requests_before, bytes_before = source.stats().requests, source.stats().bytes
        outcome = CatchUpDay(day, "stored")
        try:
            report = ingest_day(day, source, repository, margin=margin, now=now())
            outcome.transactions = report.stored
        except NoEligibleTransactionsError as exc:
            repository.record_empty_days([day])  # same as the history load: checked, nothing to store
            outcome.status, outcome.detail = "empty", str(exc)
        except (IngestionError, SourceError) as exc:  # nothing stored for this day
            outcome.status, outcome.detail = "failed", str(exc)
            result.rate_limited = isinstance(exc, RateLimitedError)
        outcome.requests = source.stats().requests - requests_before
        outcome.megabytes = round((source.stats().bytes - bytes_before) / 1e6, 1)
        outcome.seconds = round(time.monotonic() - t0, 1)
        result.days.append(outcome)
        log.info("DAY %s %s transactions=%d requests=%d downloaded=%.1fMB seconds=%.1f%s", day, outcome.status,
                 outcome.transactions, outcome.requests, outcome.megabytes, outcome.seconds,
                 f" error={outcome.detail}" if outcome.detail else "")
        if outcome.status == "failed":
            break  # the next run retries from this day
    result.seconds = round(time.monotonic() - started, 1)
    stored = sum(d.status == "stored" for d in result.days)
    empty = sum(d.status == "empty" for d in result.days)
    log.info("CATCHUP SUMMARY missing=%d stored=%d empty=%d failed=%d not_tried=%d seconds=%.1f",
             len(days), stored, empty, int(result.failed), len(days) - len(result.days), result.seconds)
    return result
