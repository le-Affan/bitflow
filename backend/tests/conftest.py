import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.fail("TEST_DATABASE_URL is not set. Run the tests with: docker compose --profile test run --rm backend-test")
    return url


def _create_database_if_missing(url: str) -> None:
    target = make_url(url)
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": target.database}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    admin.dispose()


@pytest.fixture(scope="session")
def db_engine():
    url = _test_database_url()
    _create_database_if_missing(url)
    # Schema comes only from the Alembic migrations: drop everything, then upgrade to head.
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def repo(db_engine):
    from app.repository.postgres import PostgresDayRepository

    with db_engine.begin() as conn:
        conn.execute(text("TRUNCATE ingested_days, transactions, tx_inputs, tx_outputs, checked_empty_days"))
    return PostgresDayRepository(db_engine)
