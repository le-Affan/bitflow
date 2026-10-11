"""Add checked_empty_days: UTC days that were checked and had 0 eligible transactions (nothing to store).

Purely additive: a new table, no change to existing tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "checked_empty_days",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("checked_empty_days")
