# BitFlow backend

FastAPI service. Exposes only `GET /health` so far. Data access lives in `app/repository/` behind the `DayRepository` protocol; the schema is created only by Alembic migrations in `migrations/`.

Run everything from the repository root with Docker Compose (needs a `.env`, copy from `.env.example` and set `POSTGRES_PASSWORD`):

```bash
docker compose up -d --build                                  # postgres + backend on 127.0.0.1:8000
docker compose run --rm backend alembic upgrade head          # apply migrations
docker compose --profile test run --rm --build backend-test   # run tests against the real postgres container
```

The tests use a separate database (`POSTGRES_TEST_DB`, default `bitflow_test`) that they create if missing and wipe on every run.
