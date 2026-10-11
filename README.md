# BitFlow

Bitcoin transaction visualizer. BitFlow keeps its own growing dataset of Bitcoin blockchain activity and renders the top 100 transactions of a chosen UTC day or date range as an interactive graph: addresses are nodes, address-to-address transfers are directed edges.

History (2009-01-03 to 2026-10-08) was loaded once from Google BigQuery's public Bitcoin dataset. From 2026-10-09 on, days are ingested daily from a public Bitcoin API (blockchain.info).

- Product requirements: [`docs/BitFlow_PRD.md`](docs/BitFlow_PRD.md)
- Backend: [`backend/`](backend/README.md) (FastAPI, PostgreSQL)
- Frontend: `frontend/` (React + TypeScript, Cytoscape.js)
- Docker: `docker-compose.yml`, `docker/`

## Run it on a fresh machine

You need Docker with Docker Compose v2 (Docker Desktop on Mac/Windows, or Docker Engine plus the compose plugin on Linux) and an internet connection. Nothing else: no Python, Node, database or cloud tools, and no `.env` file.

1. **Install Docker and make sure it is running.**
2. **Get the project.** Clone this repository or download it as a zip and unzip it and open a terminal in its folder.
3. **Download the database dump** (about 308 MB):
   https://drive.google.com/file/d/1acUQmGI4BnR7tnGcjk7kauAY6hpzSOIN/view?usp=sharing
4. **Put it at exactly `seed/bitflow.dump`** inside the project folder. If the browser renamed it (for example `bitflow (1).dump`), rename it back.
5. **Start everything:**
   ```sh
   docker compose up -d --build
   ```
   This starts the database, restores the dump into it at first start only, updates the schema, then starts the backend, the frontend and the scheduler. The first build takes a few minutes.
6. **Open http://127.0.0.1:3000** and explore.

The dump is a snapshot up to the day it was exported. On start, the app fills every day since then automatically (see "How it behaves"). The app is usable meanwhile.

Optional: to change ports, the daily time or the database password, copy `.env.example` to `.env` and uncomment the lines you need. `.env` takes priority over the defaults in `docker-compose.yml`.

> **Defaults are for local use.** The database password defaults to `bitflow`: change `POSTGRES_PASSWORD` (in `.env`) before any real deployment. The database itself is not published on the host; only the frontend (3000) and the backend API (8000) are, on 127.0.0.1.

Useful commands:

```sh
docker compose ps                      # what is running
docker compose logs -f scheduler       # ingestion progress (one line per day, then a summary)
docker compose logs db-init            # what happened with the seed on first start
docker compose down                    # stop; the data stays in the named volume
docker compose down -v                 # stop AND delete the database (the next start seeds again)
docker compose run --rm scheduler python -m app.ingestion catch-up   # run a catch-up now
```

How it behaves:

- **Data is kept** in the Docker volume `bitflow_postgres-data`. Restarts and rebuilds keep it.
- **The seed is used only once**, when the database is empty. Later starts never restore it again, even if the file is still there.
- **Missing days are filled automatically.** The `scheduler` container runs a catch-up when it starts and then every day at `DAILY_INGEST_TIME_UTC` (default 00:30 UTC). A catch-up ingests every complete UTC day after the newest day in the database, up to yesterday, oldest first. It never ingests today and never touches days before 2026-10-09. If the stack was off at 00:30, that run is simply missed: the next start or the next day catches up all missing days.
- **The app stays usable** while a catch-up runs; it serves the days already stored.
- **A failed day changes nothing.** Each day is stored all-or-nothing; on a failure the catch-up stops and the next run retries from that day.
- **Without a seed file** the app starts empty and the scheduler ingests days from 2026-10-09 on, one by one (slow, see below). To use a dump later: `docker compose down -v`, put the file in `seed/`, start again.
- **Ports** are bound to 127.0.0.1 only. If 3000 or 8000 is taken, set `FRONTEND_HOST_PORT` / `BACKEND_HOST_PORT` in `.env` and rebuild (`docker compose up -d --build`); the default CORS origins and API URL follow those ports.

### How long things take

Measured on one machine (Linux, home internet), 2026-10-11:

| Step | Measured |
|---|---|
| Restoring the seed (308 MB dump, 6,230 days) | 21 s |
| Fresh stack start with images already built, until the API answered | 36 s |
| Catch-up of one day (2026-10-10: 155 blocks, 162 requests to blockchain.info) | 885 s (14.7 min), about 320 MB downloaded |

Not measured (guesses):

- The very first `docker compose up --build` on a new machine also downloads base images and installs dependencies; expect a few extra minutes depending on the connection.
- A gap of N missing days takes roughly N × 15 minutes (extrapolated from the one measured day; blocks per day and the source's speed vary). blockchain.info does not publish its rate limits, so ingestion fetches one block at a time with a pause and backs off on errors. A gap of a month could take most of a day. The app stays usable meanwhile and the new days appear one by one.
- **So: export a fresh dump right before handing the project over** (`scripts/make_seed_dump.sh` writes `seed/bitflow.dump` from the running stack), so the gap the receiver has to catch up is as small as possible.

## If something goes wrong

| Problem | Fix |
|---|---|
| `docker: command not found`, or "Cannot connect to the Docker daemon" | Install Docker, or start Docker Desktop and wait until it says it is running. |
| The app opens but shows no data | The dump was missing or misnamed on first start. Check `docker compose logs db-init`. Fix: make sure the file is exactly `seed/bitflow.dump`, then `docker compose down -v` and `docker compose up -d --build`. |
| `db-init` says the restore failed, or the dump looks too small | The download was probably incomplete. The file should be about 308 MB. Download it again, then `docker compose down -v` and start again. |
| The file is called `bitflow (1).dump` or similar | Rename it to `bitflow.dump`. |
| Google Drive says it can't scan for viruses | Click **Download anyway**. The file is a database dump of public blockchain data. |
| "port is already allocated" or "address already in use" (3000 or 8000) | Something else uses the port. Copy `.env.example` to `.env`, uncomment and change `FRONTEND_HOST_PORT` / `BACKEND_HOST_PORT`, then `docker compose up -d --build`. Open the new port. |
| The page loads but graphs never appear | The backend may not be up yet. Run `docker compose ps` and `docker compose logs backend`. Wait for it to be healthy. If you changed ports, rebuild with `docker compose up -d --build`. |
| I added the dump after starting once, and nothing changed | The seed only runs on an empty database. Run `docker compose down -v` (this deletes the database), then `docker compose up -d --build`. |
| New days are not appearing | Catch-up is slow (about 15 minutes per day). Check `docker compose logs -f scheduler`. It needs internet access to reach blockchain.info. If it reports a failed day, it retries on the next run; you can run `docker compose run --rm scheduler python -m app.ingestion catch-up` yourself. |
| A big graph draws slowly | Very large days or ranges (tens of thousands of edges) can take several seconds to draw. Wait for it to finish. |
| I want to start over completely | `docker compose down -v`, then `docker compose up -d --build`. |

## Deploying to a cloud

The same setup runs on any host or cloud that can run containers. What you need, without any provider-specific setup:

- The images built from `docker-compose.yml`: backend (also used for the one-shot `migrate` step and the `scheduler`), frontend (static files served by nginx) and the one-shot `db-init` seeding step (plain `postgres:17-alpine` with `docker/db-init.sh`).
- A PostgreSQL 17 database; the backend gets it as `DATABASE_URL` (see `docker-compose.yml` for the format).
- The environment variables listed in `.env.example` (all have local defaults; set a real `POSTGRES_PASSWORD`). Set `VITE_API_BASE_URL` to the public URL of the backend before building the frontend image (it is baked into the static build), and `CORS_ALLOW_ORIGINS` to the public URL of the frontend.
- The seed dump restored once into the empty database (what `db-init` does), then `alembic upgrade head` (what `migrate` does).
- A daily trigger that runs `python -m app.ingestion catch-up` in the backend image (the `scheduler` container does this; a cron job or a scheduled task works too). It is safe to run more often: with nothing missing it does nothing and exits 0. Exit code 1 = a day failed (retried next run), 3 = rate limited.