"""Composition root for the one-time BigQuery history load (one exported chunk per call).

    python -m app.ingestion.history_cli --blocks blocks.csv --candidates candidates.csv \\
        --start YYYY-MM-DD --end YYYY-MM-DD --before YYYY-MM-DD

Loads every UTC day in [start, end] that is not stored yet, from the export, through core.ingest_day.
--before is the first day owned by the daily ingestion job; nothing on or after it is touched.
Prints one JSON summary line. Exit code 0 unless a day failed (1) or the arguments are invalid (2).
"""
import argparse
import json
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from app.config import database_url
from app.ingestion.history import load_days
from app.ingestion.source import SourceError
from app.repository.postgres import PostgresDayRepository
from app.sources.bigquery_export import BigQueryExportSource


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.ingestion.history_cli")
    p.add_argument("--blocks", required=True, type=Path)
    p.add_argument("--candidates", required=True, type=Path)
    p.add_argument("--start", required=True, type=date.fromisoformat)
    p.add_argument("--end", required=True, type=date.fromisoformat)
    p.add_argument("--before", required=True, type=date.fromisoformat)
    a = p.parse_args(argv)
    if a.end < a.start or a.end >= a.before:
        print(json.dumps({"error": f"need start <= end < before, got {a.start} {a.end} {a.before}"}))
        return 2
    try:
        source = BigQueryExportSource.from_files(a.blocks, a.candidates)
    except SourceError as exc:
        print(json.dumps({"error": f"invalid export: {exc}"}))
        return 1
    days = [a.start + timedelta(days=i) for i in range((a.end - a.start).days + 1)]
    outcomes = load_days(days, source, PostgresDayRepository.from_url(database_url()), before=a.before)
    counts = Counter(o.status for o in outcomes)
    loaded = [o for o in outcomes if o.status == "loaded"]
    print(json.dumps({
        "start": str(a.start), "end": str(a.end), "counts": dict(counts),
        "transactions": sum(o.transactions for o in loaded), "inputs": sum(o.inputs for o in loaded),
        "outputs": sum(o.outputs for o in loaded),
        "under_100": [[str(o.day), o.transactions] for o in loaded if o.transactions < 100],
        "empty_days": [str(o.day) for o in outcomes if o.status == "empty"],
        "failed": [[str(o.day), o.detail] for o in outcomes if o.status == "failed"],
    }))
    return 1 if counts.get("failed") else 0


if __name__ == "__main__":
    sys.exit(main())
