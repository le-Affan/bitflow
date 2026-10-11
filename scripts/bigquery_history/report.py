#!/usr/bin/env python3
"""Writes scripts/load_report.md from the history load's progress.log, ledger.jsonl, state.json and a read-only
query of the stored days. Run from the repository root after (or after a stop of) load.py.

Usage: python3 scripts/bigquery_history/report.py --run-start ISO --skipped-years "" [--extra "markdown text"]
"""
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REPORT = ROOT / "scripts" / "load_report.md"


def psql(sql: str) -> str:
    return subprocess.run(["docker", "compose", "exec", "-T", "postgres", "sh", "-c",
                           'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|"'],
                          input=sql, capture_output=True, text=True, cwd=ROOT, check=True).stdout.strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-start", required=True)
    ap.add_argument("--skipped-years", default="")
    ap.add_argument("--extra", default="")
    a = ap.parse_args()
    lines = (HERE / "progress.log").read_text().splitlines()
    run = [l for l in lines if l[:20] >= a.run_start[:20]]
    ledger = [json.loads(l) for l in (HERE / "ledger.jsonl").read_text().splitlines() if l.strip()]
    run_ledger = [r for r in ledger if r["time"] >= a.run_start]
    state = json.loads((HERE / "state.json").read_text())
    chunk_lines = [l for l in run if " CHUNK " in l and "dry_bytes=" in l]
    stop = next((l for l in run if " STOP " in l), None)
    done = next((l for l in run if " DONE " in l), None)
    month_billed = None
    for l in run:
        m = re.search(r"month_billed=(\d+)", l)
        if m:
            month_billed = int(m.group(1))
    loaded_days = sum(int(re.search(r"days_loaded=(\d+)", l).group(1)) for l in chunk_lines)
    txs = sum(int(re.search(r"transactions=(\d+)", l).group(1)) for l in chunk_lines)
    rows = sum(int(re.search(r" rows=(\d+)", l).group(1)) for l in chunk_lines)
    billed = sum(r["billed"] for r in run_ledger)
    over = [r for r in run_ledger if r["estimate"] and r["processed"] > r["estimate"] * 1.2 and r["processed"] > 10 * 1024 * 1024]
    db = psql("SELECT count(*), min(day), max(day), sum(transaction_count) FROM ingested_days;").split("|")
    years = psql("SELECT extract(year FROM day)::int, count(*), sum(transaction_count) FROM ingested_days GROUP BY 1 ORDER BY 1;")
    git = subprocess.run(["git", "status", "--short"], capture_output=True, text=True, cwd=ROOT).stdout.strip() or "(clean)"
    under = state.get("under_100", {})
    out = [
        "# BigQuery history load report", "",
        f"- Run start: {a.run_start}",
        f"- Run end: {run[-1][:20] if run else '?'}",
        f"- Result: {'STOPPED EARLY' if stop else 'finished' if done else 'unknown (no DONE/STOP line)'}",
    ]
    if stop:
        out.append(f"- Stop reason: `{stop[21:]}`")
    out += [
        f"- Chunks processed this run: {len(chunk_lines)} (chunks skipped as already done: {sum(' skip:' in l for l in run)})",
        f"- Days loaded this run: {loaded_days}; transactions: {txs}; input/output rows: {rows}",
        f"- Years skipped by choice: {a.skipped_years or 'none'}",
        f"- Bytes billed this run (ledger, real queries only): {billed:,} B ({billed / 1e9:.2f} GB)",
        f"- Month total billed (BigQuery job history at start + this run): {month_billed:,} B ({month_billed / 1e9:.2f} GB)" if month_billed else "- Month total billed: unknown",
        f"- Queries processed more than 20 % above the dry run: {len(over)}",
        "",
        "## Stored days now (read-only query)", "",
        f"- Days stored: {db[0]} (from {db[1]} to {db[2]}), transactions: {db[3]}",
        "", "| Year | Days stored | Transactions |", "|---|---:|---:|",
    ]
    for l in years.splitlines():
        y, n, t = l.split("|")
        out.append(f"| {y} | {n} | {t} |")
    out += [
        "", "## Days not stored", "",
        f"- Days with no eligible transactions or no blocks (checked, nothing to store): {len(state.get('empty_days', []))}"
        + (f" (first {state['empty_days'][0]}, last {state['empty_days'][-1]})" if state.get("empty_days") else ""),
        "", "## Days with fewer than 100 transactions", "",
        f"- Count: {len(under)}" + (f" (e.g. {', '.join(f'{d}: {n}' for d, n in sorted(under.items())[:5])})" if under else ""),
        "", "## Notes", "",
        *(f"- {n}" for n in state.get("notes", [])),
        *(["- (none)"] if not state.get("notes") else []),
    ]
    if a.extra:
        out += ["", a.extra]
    out += ["", "## git status (read-only)", "", "```", git, "```", "",
            f"_Generated {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} by scripts/bigquery_history/report.py._", ""]
    REPORT.write_text("\n".join(out))
    print(REPORT.read_text())


if __name__ == "__main__":
    main()
