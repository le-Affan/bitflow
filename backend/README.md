# BitFlow backend

FastAPI service. Exposes `GET /health` and the read-only API under `/api` (`/days`, `/graph`, `/addresses/{address}`, `/edges`, `/transactions/{txid}`); interactive docs at `/docs`. Data access lives in `app/repository/` behind the `DayRepository` protocol; the schema is created only by Alembic migrations in `migrations/`.

Run everything from the repository root with Docker Compose (needs a `.env`, copy from `.env.example` and set `POSTGRES_PASSWORD`):

```bash
docker compose up -d --build                                  # postgres + backend on 127.0.0.1:8000
docker compose run --rm backend alembic upgrade head          # apply migrations
docker compose --profile test run --rm --build backend-test   # run tests against the real postgres container
docker compose run --rm --build backend python -m app.ingestion --date 2026-10-09   # ingest one complete UTC day
```

Ingestion (`app/ingestion/`) reads blocks through the `BlockSource` protocol; the only implementation is the blockchain.info adapter in `app/sources/blockchain_info/`. Tuning (pause, retries, timeouts, margin) comes from the `INGEST_*` variables in `.env.example`. Exit codes: 0 stored, 1 failed (nothing stored), 2 invalid date, 3 rate limited.

The tests use a separate database (`POSTGRES_TEST_DB`, default `bitflow_test`) that they create if missing and wipe on every run.
