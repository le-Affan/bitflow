"""Initial schema: ingested days and their top-100 transactions with inputs and outputs.

Revision ID: 0001
Revises:
Create Date: 2026-10-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ingested_days",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transaction_count", sa.Integer, nullable=False),
        sa.CheckConstraint("status IN ('ingested')", name="ck_ingested_days_status"),
        sa.CheckConstraint("transaction_count >= 0", name="ck_ingested_days_count"),
    )
    op.create_table(
        "transactions",
        sa.Column("day", sa.Date, nullable=False),
        sa.Column("txid", sa.String(64), nullable=False),
        sa.Column("block_height", sa.Integer, nullable=False),
        sa.Column("block_time", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("day", "txid"),
        sa.ForeignKeyConstraint(["day"], ["ingested_days.day"], ondelete="CASCADE"),
        sa.CheckConstraint("block_height >= 0", name="ck_transactions_block_height"),
        # A block belongs to the UTC day of its own timestamp.
        sa.CheckConstraint("(block_time AT TIME ZONE 'UTC')::date = day", name="ck_transactions_block_time_day"),
    )
    for name in ("tx_inputs", "tx_outputs"):
        op.create_table(
            name,
            sa.Column("day", sa.Date, nullable=False),
            sa.Column("txid", sa.String(64), nullable=False),
            sa.Column("position", sa.Integer, nullable=False),
            sa.Column("address", sa.String, nullable=False),
            sa.Column("value_sat", sa.BigInteger, nullable=False),
            sa.PrimaryKeyConstraint("day", "txid", "position"),
            sa.ForeignKeyConstraint(
                ["day", "txid"], ["transactions.day", "transactions.txid"], ondelete="CASCADE"
            ),
            sa.CheckConstraint("position >= 0", name=f"ck_{name}_position"),
            sa.CheckConstraint("value_sat >= 0", name=f"ck_{name}_value_sat"),
            sa.CheckConstraint("address <> ''", name=f"ck_{name}_address"),
        )


def downgrade() -> None:
    op.drop_table("tx_outputs")
    op.drop_table("tx_inputs")
    op.drop_table("transactions")
    op.drop_table("ingested_days")
