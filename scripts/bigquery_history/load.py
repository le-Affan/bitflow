#!/usr/bin/env python3
"""One-time history load from BigQuery into BitFlow, through the normal ingestion path.

Per chunk (a calendar month, or a year for small early years), newest first:
  1. skip the chunk if every day in it is already stored (asked from the running backend API) or known empty;
  2. dry-run both queries (blocks.sql, candidates.sql), check the 50 GB per-query guard and the monthly budget;
  3. run them with --maximum_bytes_billed, export CSV into cache/<chunk>/;
  4. run `python -m app.ingestion.history_cli` in the backend container on that export. It goes through
     app.sources.bigquery_export -> app.ingestion.core.ingest_day -> repository.replace_day, skips days that are
     already stored (never overwrites) and refuses any day on or after --before.

Stops the whole job (exit 3) on: monthly budget would pass --budget-gb, quota / rate-limit / HTTP 429 errors,
processed bytes more than 20 % above the dry-run estimate, or a chunk that fails twice.
Writes: progress.log (one line per chunk), ledger.jsonl (every real query), state.json (empty days, resume info).
Needs: bq CLI (logged in), the stack running (backend API on 127.0.0.1:8000), run from the repository root.

    python3 scripts/bigquery_history/load.py --before 2026-10-09 --only 2026-09
    python3 scripts/bigquery_history/load.py --before 2026-10-09 --skip-years 2009,2010
"""
import argparse
import calendar
import json
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / "cache"
LEDGER = HERE / "ledger.jsonl"
STATE = HERE / "state.json"
PROGRESS = HERE / "progress.log"
GENESIS_DAY = date(2009, 1, 3)
QUERY_GUARD_BYTES = 50 * 10**9  # no single query above 50 GB
OVERRUN = 1.20  # stop if processed bytes exceed the dry-run estimate by more than 20 %
MIN_BILLED = 10 * 1024 * 1024  # BigQuery bills at least 10 MiB per query
MONTHLY_CHUNK_FROM_YEAR = 2016  # 2016+ in months (largest single month ~7.7 GB); earlier years as one query


class Stop(Exception):
    """Stop the whole job."""


def log(msg: str) -> None:
    line = f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} {msg}"
    print(line, flush=True)
    with PROGRESS.open("a") as f:
        f.write(line + "\n")


def chunks(before: date, years: list[int]) -> list[tuple[str, date, date]]:
    out = []
    last = before - timedelta(days=1)
    for y in years:
        if y >= MONTHLY_CHUNK_FROM_YEAR:
            for m in range(12, 0, -1):
                s = date(y, m, 1)
                e = date(y, m, calendar.monthrange(y, m)[1])
                if s > last:
                    continue
                out.append((f"{y}-{m:02d}", s, min(e, last)))
        else:
            s, e = max(date(y, 1, 1), GENESIS_DAY), min(date(y, 12, 31), last)
            if s <= e:
                out.append((str(y), s, e))
    return out


def ingested_days() -> set[str]:
    with urllib.request.urlopen("http://127.0.0.1:8000/api/days", timeout=60) as r:
        return {d["date"] for d in json.load(r)}


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {"empty_days": [], "under_100": {}, "notes": []}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True))


def month_billed_from_history() -> int:
    """Bytes billed by this project's query jobs since the start of the current UTC month (bq job history)."""
    out = subprocess.run(["bq", "ls", "-j", "-a", "-n", "100000", "--format=json"], capture_output=True, text=True, check=True).stdout
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000
    total = 0
    for j in json.loads(out or "[]"):
        conf, stats = j.get("configuration", {}), j.get("statistics", {})
        if not conf.get("query") or conf.get("dryRun") or float(stats.get("creationTime", 0)) < month_start:
            continue
        total += int(stats.get("query", {}).get("totalBytesBilled") or 0)
    return total


def bq_fatal(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in ("quota", "ratelimit", "rate limit", "429", "too many requests", "billing"))


def dry_run(sql: Path, params: list[str]) -> int:
    p = subprocess.run(["bq", "query", "--nouse_legacy_sql", "--dry_run", "--format=json", *params],
                       stdin=sql.open(), capture_output=True, text=True)
    if p.returncode != 0:
        if bq_fatal(p.stdout + p.stderr):
            raise Stop(f"dry run of {sql.name}: quota/rate limit: {(p.stdout + p.stderr).strip()[:300]}")
        raise RuntimeError(f"dry run of {sql.name} failed: {(p.stdout + p.stderr).strip()[:300]}")
    return int(json.loads(p.stdout)["statistics"]["totalBytesProcessed"])


def run_query(sql: Path, params: list[str], estimate: int, out_csv: Path, chunk: str) -> dict:
    if estimate > QUERY_GUARD_BYTES:
        raise Stop(f"{sql.name} for {chunk}: dry run {estimate} B is over the 50 GB per-query guard")
    max_billed = min(int(estimate * OVERRUN) + MIN_BILLED, QUERY_GUARD_BYTES)
    job_id = f"bitflow_history_{chunk.replace('-', '_')}_{sql.stem}_{uuid.uuid4().hex[:8]}"
    with out_csv.open("w") as f:
        p = subprocess.run(["bq", "query", "--nouse_legacy_sql", f"--maximum_bytes_billed={max_billed}", "--format=csv",
                            "--max_rows=1000000000", f"--job_id={job_id}", *params],
                           stdin=sql.open(), stdout=f, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        err = out_csv.read_text()[-500:] + p.stderr[-500:]
        if bq_fatal(err):
            raise Stop(f"{sql.name} for {chunk}: quota/rate limit: {err.strip()[:300]}")
        if "bytes billed" in err.lower() and "limit" in err.lower():
            raise Stop(f"{sql.name} for {chunk}: would bill more than {OVERRUN:.0%} of the estimate: {err.strip()[:300]}")
        raise RuntimeError(f"{sql.name} for {chunk} failed: {err.strip()[:300]}")
    s = json.loads(subprocess.run(["bq", "show", "--format=json", "-j", job_id], capture_output=True, text=True, check=True).stdout)
    q = s["statistics"]["query"]
    rec = {"time": datetime.now(timezone.utc).isoformat(), "chunk": chunk, "query": sql.name, "job": job_id,
           "estimate": estimate, "processed": int(q.get("totalBytesProcessed") or 0), "billed": int(q.get("totalBytesBilled") or 0)}
    with LEDGER.open("a") as f:
        f.write(json.dumps(rec) + "\n")
    if rec["processed"] > estimate * OVERRUN and rec["processed"] > MIN_BILLED:
        raise Stop(f"{sql.name} for {chunk}: processed {rec['processed']} B is more than 20 % above the estimate {estimate} B")
    return rec


def ingest(chunk: str, start: date, end: date, before: date) -> tuple[int, dict]:
    d = f"/data/{chunk}"
    cmd = ["docker", "compose", "run", "--rm", "-T", "-v", f"{CACHE}:/data:ro,z", "backend", "python", "-m",
           "app.ingestion.history_cli", "--blocks", f"{d}/blocks.csv", "--candidates", f"{d}/candidates.csv",
           "--start", str(start), "--end", str(end), "--before", str(before)]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    lines = [l for l in p.stdout.splitlines() if l.startswith("{")]
    if not lines:
        return 99, {"error": (p.stdout + p.stderr).strip()[-500:]}
    return p.returncode, json.loads(lines[-1])


def candidates_per_day(csv_path: Path) -> dict[str, int]:
    days: dict[str, set] = {}
    with csv_path.open() as f:
        next(f, None)
        for line in f:
            parts = line.split(",", 3)
            days.setdefault(parts[0], set()).add(parts[2])
    return {d: len(t) for d, t in days.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", required=True, type=date.fromisoformat, help="first day owned by the daily job")
    ap.add_argument("--only", help="single chunk, e.g. 2026-09 or 2014")
    ap.add_argument("--from-year", type=int, default=None)
    ap.add_argument("--to-year", type=int, default=2009)
    ap.add_argument("--skip-years", default="", help="comma-separated years not to load")
    ap.add_argument("--budget-gb", type=float, default=800.0, help="hard stop for this month's billed bytes")
    a = ap.parse_args()
    CACHE.mkdir(exist_ok=True)
    first_year = a.from_year or (a.before - timedelta(days=1)).year
    skip = {int(y) for y in a.skip_years.split(",") if y}
    years = [y for y in range(first_year, a.to_year - 1, -1) if y not in skip]
    plan = chunks(a.before, years)
    if a.only:
        plan = [c for c in plan if c[0] == a.only]
        if not plan:
            raise SystemExit(f"no chunk {a.only}")
    budget = int(a.budget_gb * 10**9)
    state = load_state()
    month_billed = month_billed_from_history()
    run_billed = 0
    log(f"START chunks={len(plan)} before={a.before} skip_years={sorted(skip)} month_billed={month_billed} budget={budget}")
    try:
        for chunk, start, end in plan:
            days = {str(start + timedelta(days=i)) for i in range((end - start).days + 1)}
            done = ingested_days() | set(state["empty_days"])
            if days <= done:
                log(f"CHUNK {chunk} skip: all {len(days)} days already stored or known empty")
                continue
            params = [f"--parameter=start:DATE:{start}", f"--parameter=end:DATE:{end}"]
            est_blocks = dry_run(HERE / "blocks.sql", params)
            est_cand = dry_run(HERE / "candidates.sql", params)
            worst = max(int(est_blocks * OVERRUN), MIN_BILLED) + max(int(est_cand * OVERRUN), MIN_BILLED)
            if month_billed + worst > budget:
                raise Stop(f"HARD STOP before {chunk}: month billed {month_billed} B + up to {worst} B would pass {budget} B")
            out = CACHE / chunk
            out.mkdir(exist_ok=True)
            billed = 0
            for attempt in (1, 2):
                try:
                    r1 = run_query(HERE / "blocks.sql", params, est_blocks, out / "blocks.csv", chunk)
                    month_billed += r1["billed"]; run_billed += r1["billed"]; billed += r1["billed"]
                    r2 = run_query(HERE / "candidates.sql", params, est_cand, out / "candidates.csv", chunk)
                    month_billed += r2["billed"]; run_billed += r2["billed"]; billed += r2["billed"]
                    break
                except RuntimeError as exc:
                    log(f"CHUNK {chunk} query attempt {attempt} failed: {exc}")
                    if attempt == 2:
                        raise Stop(f"chunk {chunk} failed twice (queries)") from exc
            cand_days = candidates_per_day(out / "candidates.csv")
            for attempt in (1, 2):
                code, res = ingest(chunk, start, end, a.before)
                failed = res.get("failed", [])
                # A failed day with no exported candidates has nothing that could be stored (e.g. the genesis day,
                # whose margin blocks would be below height 0). It is recorded as empty, never as loaded.
                benign = [f for f in failed if cand_days.get(f[0], 0) == 0]
                if code == 0 or (code == 1 and failed and len(benign) == len(failed)):
                    for f in benign:
                        state["notes"].append(f"{f[0]}: failed before ranking with 0 candidates ({f[1]}); treated as empty")
                    break
                log(f"CHUNK {chunk} ingest attempt {attempt} failed: code={code} {json.dumps(res)[:400]}")
                if attempt == 2:
                    raise Stop(f"chunk {chunk} failed twice (ingestion)")
            empty = set(res.get("empty_days", [])) | {f[0] for f in benign}
            state["empty_days"] = sorted(set(state["empty_days"]) | empty)
            state["under_100"].update({d: n for d, n in res.get("under_100", [])})
            save_state(state)
            c = res.get("counts", {})
            log(f"CHUNK {chunk} dry_bytes={est_blocks + est_cand} billed_bytes={billed} days_loaded={c.get('loaded', 0)} "
                f"skipped={c.get('skipped', 0)} empty={len(empty)} transactions={res.get('transactions', 0)} "
                f"rows={res.get('inputs', 0) + res.get('outputs', 0)} under_100={len(res.get('under_100', []))} "
                f"month_billed={month_billed}")
    except Stop as exc:
        log(f"STOP {exc} run_billed={run_billed} month_billed={month_billed}")
        return 3
    log(f"DONE run_billed={run_billed} month_billed={month_billed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
