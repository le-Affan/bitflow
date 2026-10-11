"""Daily scheduler for the `scheduler` container: catch-up once at start, then once a day at a fixed UTC time.

    python -m app.ingestion.scheduler

The time comes from DAILY_INGEST_TIME_UTC ("HH:MM", default 00:30). A run missed because the container was down is
not replayed; the next run (at the next start or the next day) catches up every missing day anyway.
"""
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from app.ingestion.__main__ import main as ingestion_main

log = logging.getLogger("bitflow.scheduler")


def daily_time() -> tuple[int, int]:
    value = os.environ.get("DAILY_INGEST_TIME_UTC") or "00:30"
    hours, minutes = (int(p) for p in value.split(":"))
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise ValueError(f"DAILY_INGEST_TIME_UTC must be HH:MM, got {value!r}")
    return hours, minutes


def next_run(now: datetime, hours: int, minutes: int) -> datetime:
    """The next time today or tomorrow (UTC) at hours:minutes, strictly after `now`."""
    candidate = now.astimezone(timezone.utc).replace(hour=hours, minute=minutes, second=0, microsecond=0)
    return candidate if candidate > now else candidate + timedelta(days=1)


def run_catch_up() -> None:
    try:
        code = ingestion_main(["catch-up"])
        log.info("catch-up finished with exit code %d", code)
    except Exception:  # keep the scheduler alive; the next run retries
        log.exception("catch-up crashed")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    hours, minutes = daily_time()
    log.info("scheduler started: catch-up now, then daily at %02d:%02d UTC", hours, minutes)
    run_catch_up()
    while True:
        at = next_run(datetime.now(timezone.utc), hours, minutes)
        log.info("next catch-up at %s", at.isoformat())
        time.sleep(max(0.0, (at - datetime.now(timezone.utc)).total_seconds()))
        run_catch_up()


if __name__ == "__main__":
    sys.exit(main())
