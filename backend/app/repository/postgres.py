from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Sequence

from sqlalchemy import Engine, create_engine, delete, insert, select

from app.domain.models import DayStatus, IngestedDay, Transaction, TxInput, TxOutput
from app.repository.tables import ingested_days, transactions, tx_inputs, tx_outputs


class PostgresDayRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    @classmethod
    def from_url(cls, url: str) -> "PostgresDayRepository":
        return cls(create_engine(url))

    def replace_day(self, day: date, txs: Sequence[Transaction]) -> IngestedDay:
        record = IngestedDay(
            day=day,
            status=DayStatus.INGESTED,
            ingested_at=datetime.now(timezone.utc),
            transaction_count=len(txs),
        )
        # One DB transaction: commit on success, roll back on any error.
        with self._engine.begin() as conn:
            # Child rows go via ON DELETE CASCADE.
            conn.execute(delete(ingested_days).where(ingested_days.c.day == day))
            conn.execute(
                insert(ingested_days).values(
                    day=record.day,
                    status=record.status.value,
                    ingested_at=record.ingested_at,
                    transaction_count=record.transaction_count,
                )
            )
            if txs:
                conn.execute(
                    insert(transactions),
                    [
                        {"day": day, "txid": t.txid, "block_height": t.block_height, "block_time": t.block_time}
                        for t in txs
                    ],
                )
            input_rows = [
                {"day": day, "txid": t.txid, "position": i.position, "address": i.address, "value_sat": i.value_sat}
                for t in txs
                for i in t.inputs
            ]
            if input_rows:
                conn.execute(insert(tx_inputs), input_rows)
            output_rows = [
                {"day": day, "txid": t.txid, "position": o.position, "address": o.address, "value_sat": o.value_sat}
                for t in txs
                for o in t.outputs
            ]
            if output_rows:
                conn.execute(insert(tx_outputs), output_rows)
        return record

    def list_ingested_days(self) -> list[IngestedDay]:
        with self._engine.connect() as conn:
            rows = conn.execute(select(ingested_days).order_by(ingested_days.c.day)).all()
        return [_to_day(r) for r in rows]

    def get_latest_day(self) -> IngestedDay | None:
        with self._engine.connect() as conn:
            row = conn.execute(select(ingested_days).order_by(ingested_days.c.day.desc()).limit(1)).first()
        return _to_day(row) if row else None

    def get_day_transactions(self, day: date) -> list[Transaction]:
        with self._engine.connect() as conn:
            tx_rows = conn.execute(
                select(transactions)
                .where(transactions.c.day == day)
                .order_by(transactions.c.block_height, transactions.c.txid)
            ).all()
            in_rows = conn.execute(
                select(tx_inputs).where(tx_inputs.c.day == day).order_by(tx_inputs.c.txid, tx_inputs.c.position)
            ).all()
            out_rows = conn.execute(
                select(tx_outputs).where(tx_outputs.c.day == day).order_by(tx_outputs.c.txid, tx_outputs.c.position)
            ).all()

        inputs: dict[str, list[TxInput]] = defaultdict(list)
        for r in in_rows:
            inputs[r.txid].append(TxInput(position=r.position, address=r.address, value_sat=r.value_sat))
        outputs: dict[str, list[TxOutput]] = defaultdict(list)
        for r in out_rows:
            outputs[r.txid].append(TxOutput(position=r.position, address=r.address, value_sat=r.value_sat))

        return [
            Transaction(
                txid=r.txid,
                block_height=r.block_height,
                block_time=r.block_time,
                inputs=tuple(inputs[r.txid]),
                outputs=tuple(outputs[r.txid]),
            )
            for r in tx_rows
        ]


def _to_day(row) -> IngestedDay:
    return IngestedDay(
        day=row.day,
        status=DayStatus(row.status),
        ingested_at=row.ingested_at,
        transaction_count=row.transaction_count,
    )
