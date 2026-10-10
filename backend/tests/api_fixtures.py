"""TEST FIXTURES ONLY. Synthetic stored transactions for graph and API tests.

None of these txids, addresses, heights or amounts are real blockchain data. Do not import this module outside tests.
"""
from datetime import date, datetime, timezone

from app.domain.models import Transaction, TxInput, TxOutput

API_DAY = date(2026, 10, 9)
API_DAY_2 = date(2026, 10, 10)


def ftxid(n: int) -> str:
    return f"{n:064x}"


def ftx(n: int, ins: list[tuple[str, int]], outs: list[tuple[str, int]], day: date = API_DAY,
        height: int | None = None) -> Transaction:
    """Synthetic stored tx: `ins`/`outs` are (address, value_sat) in position order."""
    return Transaction(
        txid=ftxid(n),
        block_height=height if height is not None else 900_000 + n,
        block_time=datetime(day.year, day.month, day.day, 12, 0, n % 60, tzinfo=timezone.utc),
        inputs=tuple(TxInput(position=i, address=a, value_sat=v) for i, (a, v) in enumerate(ins)),
        outputs=tuple(TxOutput(position=i, address=a, value_sat=v) for i, (a, v) in enumerate(outs)),
    )


def fixture_day() -> list[Transaction]:
    """Synthetic day:
    tx1: A + B -> C + D          (4 edges)
    tx2: A -> A(change) + C      (self-loop dropped, A->C repeated)
    tx3: A -> C, C               (two outputs to C in one tx)
    tx4: E -> E                  (only a self-loop: E is no node)
    """
    return [
        ftx(1, [("fx-A", 500), ("fx-B", 300)], [("fx-C", 600), ("fx-D", 150)], height=900_010),
        ftx(2, [("fx-A", 1_000)], [("fx-A", 700), ("fx-C", 250)], height=900_020),
        ftx(3, [("fx-A", 90)], [("fx-C", 40), ("fx-C", 30)], height=900_005),
        ftx(4, [("fx-E", 77)], [("fx-E", 70)], height=900_030),
    ]
