"""Table definitions used for queries. The schema itself is created only by Alembic migrations."""
from sqlalchemy import BigInteger, Column, Date, DateTime, Integer, MetaData, String, Table

metadata = MetaData()

ingested_days = Table(
    "ingested_days",
    metadata,
    Column("day", Date, primary_key=True),
    Column("status", String(16), nullable=False),
    Column("ingested_at", DateTime(timezone=True), nullable=False),
    Column("transaction_count", Integer, nullable=False),
)

transactions = Table(
    "transactions",
    metadata,
    Column("day", Date, primary_key=True),
    Column("txid", String(64), primary_key=True),
    Column("block_height", Integer, nullable=False),
    Column("block_time", DateTime(timezone=True), nullable=False),
)

tx_inputs = Table(
    "tx_inputs",
    metadata,
    Column("day", Date, primary_key=True),
    Column("txid", String(64), primary_key=True),
    Column("position", Integer, primary_key=True),
    Column("address", String, nullable=False),
    Column("value_sat", BigInteger, nullable=False),
)

tx_outputs = Table(
    "tx_outputs",
    metadata,
    Column("day", Date, primary_key=True),
    Column("txid", String(64), primary_key=True),
    Column("position", Integer, primary_key=True),
    Column("address", String, nullable=False),
    Column("value_sat", BigInteger, nullable=False),
)
