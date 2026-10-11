"""Ingest from the command line.

    python -m app.ingestion --date YYYY-MM-DD   one UTC day
    python -m app.ingestion catch-up            every missing complete day up to yesterday (see catchup.py)

Exit codes: 0 stored (catch-up: nothing failed, including nothing to do), 1 ingestion failed (nothing stored for
that day), 2 invalid date, 3 rate limited (stopped).
"""
import argparse
import logging
import os
import sys
from dataclasses import asdict
from datetime import date

from app.config import database_url, ingestion_settings
from app.ingestion.catchup import catch_up
from app.ingestion.core import IngestionError, InvalidTargetDayError, ingest_day
from app.ingestion.source import RateLimitedError, SourceError
from app.repository.postgres import PostgresDayRepository
from app.sources.blockchain_info import BlockchainInfoSource
from app.sources.blockchain_info.adapter import DEFAULT_BASE_URL
from app.sources.blockchain_info.client import HttpClient

log = logging.getLogger("bitflow.ingestion")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.ingestion", description="Ingest one UTC day, or catch up.")
    parser.add_argument("command", nargs="?", choices=["catch-up"], help="ingest every missing day up to yesterday")
    parser.add_argument("--date", type=date.fromisoformat, help="target UTC day, YYYY-MM-DD")
    args = parser.parse_args(argv)
    if (args.command is None) == (args.date is None):
        parser.error("give either --date YYYY-MM-DD or catch-up")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    settings = ingestion_settings()
    client = HttpClient(
        os.environ.get("BLOCKCHAIN_INFO_BASE_URL") or DEFAULT_BASE_URL,
        pause_s=settings["pause_s"],
        max_retries=settings["max_retries"],
        backoff_base_s=settings["backoff_base_s"],
        connect_timeout_s=settings["connect_timeout_s"],
        read_timeout_s=settings["read_timeout_s"],
    )
    source = BlockchainInfoSource(client)
    repository = PostgresDayRepository.from_url(database_url())
    if args.command == "catch-up":
        try:
            result = catch_up(source, repository, margin=settings["margin_blocks"])
        finally:
            client.close()
        return 3 if result.rate_limited else 1 if result.failed else 0
    log.info("ingesting %s with %s", args.date, settings)
    try:
        report = ingest_day(args.date, source, repository, margin=settings["margin_blocks"])
    except InvalidTargetDayError as exc:
        log.error("%s", exc)
        return 2
    except RateLimitedError as exc:
        log.error("rate limited, stopped; nothing stored: %s (source stats: %s)", exc, source.stats())
        return 3
    except (IngestionError, SourceError) as exc:
        log.error("ingestion of %s failed; nothing stored: %s (source stats: %s)", args.date, exc, source.stats())
        return 1
    finally:
        client.close()

    summary = asdict(report)
    summary.pop("stored_day")
    log.info("SUMMARY %s", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
