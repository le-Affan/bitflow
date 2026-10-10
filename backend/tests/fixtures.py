"""TEST FIXTURES ONLY. Synthetic, made-up transactions for repository tests.

None of these txids, addresses or amounts are real blockchain data. Do not import this module outside tests.
"""
from datetime import date, datetime, timezone

from app.domain.models import Transaction, TxInput, TxOutput

FIXTURE_DAY = date(2026, 10, 9)
FIXTURE_DAY_2 = date(2026, 10, 10)


def fixture_txid(n: int) -> str:
    """Synthetic 64-hex-char txid."""
    return f"{n:064x}"


def fixture_tx(n: int, day: date = FIXTURE_DAY, n_inputs: int = 2, n_outputs: int = 2) -> Transaction:
    """Synthetic transaction number `n`, inside `day` (UTC)."""
    block_time = datetime(day.year, day.month, day.day, 12, 0, n % 60, tzinfo=timezone.utc)
    return Transaction(
        txid=fixture_txid(n),
        block_height=900_000 + n,
        block_time=block_time,
        inputs=tuple(
            TxInput(position=i, address=f"fixture-in-{n}-{i}", value_sat=1_000_000 * (i + 1)) for i in range(n_inputs)
        ),
        outputs=tuple(
            TxOutput(position=i, address=f"fixture-out-{n}-{i}", value_sat=500_000 * (i + 1)) for i in range(n_outputs)
        ),
    )
