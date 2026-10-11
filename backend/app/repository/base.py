from datetime import date
from typing import Iterable, Protocol, Sequence, runtime_checkable

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

    def record_empty_days(self, days: Iterable[date]) -> int:
        """Record days that were checked and had 0 eligible transactions. Days already recorded or already
        ingested are left alone (never duplicated). Returns how many days were newly recorded."""
        ...

    def is_day_empty(self, day: date) -> bool:
        """True if `day` was checked and had 0 eligible transactions."""
        ...

    def list_empty_days(self) -> list[date]:
        """All checked empty days, oldest first."""
        ...
