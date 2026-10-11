"""Record "checked, 0 eligible transactions" days from the history load's state file.

    python -m app.ingestion.empty_days_cli --state state.json --before YYYY-MM-DD

Reads the "empty_days" list written by scripts/bigquery_history/load.py, keeps only days before --before (the first
day owned by the daily ingestion job), and records them through the repository. Safe to re-run: days already recorded
or already ingested are left alone. Prints one JSON summary line.
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

from app.config import database_url
from app.repository.postgres import PostgresDayRepository


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.ingestion.empty_days_cli")
    p.add_argument("--state", required=True, type=Path)
    p.add_argument("--before", required=True, type=date.fromisoformat)
    a = p.parse_args(argv)
    days = [date.fromisoformat(d) for d in json.loads(a.state.read_text()).get("empty_days", [])]
    eligible = sorted(d for d in days if d < a.before)
    repo = PostgresDayRepository.from_url(database_url())
    added = repo.record_empty_days(eligible)
    print(json.dumps({"in_state_file": len(days), "before_cutoff": len(eligible), "ignored_on_or_after_cutoff": len(days) - len(eligible),
                      "newly_recorded": added, "total_recorded": len(repo.list_empty_days())}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
