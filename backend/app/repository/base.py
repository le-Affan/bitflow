from datetime import date
from typing import Protocol, Sequence, runtime_checkable

from app.domain.models import IngestedDay, Transaction


@runtime_checkable
class DayRepository(Protocol):
    """Storage of ingested UTC days. The rest of the app depends only on this interface."""

    def replace_day(self, day: date, transactions: Sequence[Transaction]) -> IngestedDay:
        """Atomically replace all stored data for `day` and mark it ingested.

        Either the whole new day is stored, or nothing changes.
        """
        ...

    def list_ingested_days(self) -> list[IngestedDay]:
        """All ingested days, oldest first."""
        ...

    def get_latest_day(self) -> IngestedDay | None:
        """The newest ingested day, or None if no day is ingested."""
        ...

    def get_day_transactions(self, day: date) -> list[Transaction]:
        """Stored transactions of `day` with their inputs and outputs. Empty if `day` is not ingested."""
        ...
