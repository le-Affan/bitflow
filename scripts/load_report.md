# BigQuery history load report

- Run start: 2026-10-10T23:00:01Z
- Run end: 2026-10-11T01:00:54Z
- Result: finished
- Chunks processed this run: 137 (chunks skipped as already done: 2)
- Days loaded this run: 6228; transactions: 598841; input/output rows: 8634847
- Years skipped by choice: none
- Bytes billed this run (ledger, real queries only): 627,172,179,968 B (627.17 GB)
- Month total billed (BigQuery job history at start + this run): 631,989,338,112 B (631.99 GB)
- Queries processed more than 20 % above the dry run: 0

## Stored days now (read-only query)

- Days stored: 6229 (from 2009-01-12 to 2026-10-09), transactions: 598941

| Year | Days stored | Transactions |
|---|---:|---:|
| 2009 | 115 | 212 |
| 2010 | 353 | 22629 |
| 2011 | 365 | 36500 |
| 2012 | 366 | 36600 |
| 2013 | 365 | 36500 |
| 2014 | 365 | 36500 |
| 2015 | 365 | 36500 |
| 2016 | 366 | 36600 |
| 2017 | 365 | 36500 |
| 2018 | 365 | 36500 |
| 2019 | 365 | 36500 |
| 2020 | 366 | 36600 |
| 2021 | 365 | 36500 |
| 2022 | 365 | 36500 |
| 2023 | 365 | 36500 |
| 2024 | 366 | 36600 |
| 2025 | 365 | 36500 |
| 2026 | 282 | 28200 |

## Days not stored

- Days with no eligible transactions or no blocks (checked, nothing to store): 260 (first 2009-01-03, last 2010-01-20)

## Days with fewer than 100 transactions

- Count: 296 (e.g. 2009-01-12: 7, 2009-01-14: 1, 2009-01-15: 7, 2009-01-16: 2, 2009-01-18: 1)

## Notes

- 2009-01-03: failed before ranking with 0 candidates (block -3 is not in the export); treated as empty
- 2009-01-09: failed before ranking with 0 candidates (block -2 is not in the export); treated as empty

## Gates and checks

- Phase 1 (2026-09 only, started 2026-10-10T23:00:01Z): tests 125 passed; billed 7,021,264,896 B vs dry-run 7,098,117,628 B (-1.1 %); 3 random days (2026-09-08, 2026-09-25, 2026-09-29) ranks 1/2/3/100 match mempool.space (12/12); re-running the month (orchestrator and ingestion directly on the cached export) changed nothing (snapshot identical, 0 duplicate (day, txid)); 2026-10-09 byte-identical before/after (checksum 7d311d0988fa8465b7705e6e77933803). All gates passed, Phase 2 started automatically at 2026-10-10T23:03:25Z.
- 2009-2012 spot-check before loading those years (BigQuery ranking, then mempool.space): 2010-11-15, 2011-06-15, 2012-06-15 ranks 1/2/3/100: 12/12 match. No years skipped.
- After the load: random days 2013-12-20, 2020-08-16, 2026-06-17 recomputed from the stored rows, ranks 1/2/3/100: 12/12 match mempool.space.
- Completeness: all 6,488 days from 2009-01-03 to 2026-10-08 are either stored (6,228) or recorded empty (260); none missing, none both. 0 duplicate (day, txid), 0 txids on more than one day.
- Cost guard: 274 real queries in the ledger, 0 processed more than 20 % above the dry run (worst +0.12 %); no quota errors, no HTTP 429, no chunk retries.
- Not verified: representation equality with blockchain.info for years other than 2026 (only 2026-10-08/09 were compared in the spike); the mempool.space checks cover the ranking output of sampled ranks, not every stored transaction.

## git status (read-only)

```
M .gitignore
 M backend/tests/test_architecture.py
?? backend/app/ingestion/history.py
?? backend/app/ingestion/history_cli.py
?? backend/app/sources/bigquery_export/
?? backend/tests/data/bigquery_export_sample/
?? backend/tests/test_bigquery_export_source.py
?? backend/tests/test_history_load.py
?? scripts/bigquery_history/
?? scripts/spikes/bigquery/ledger3.csv
?? scripts/spikes/bigquery/spot_2009_2012.json
?? scripts/spikes/bigquery/spot_2009_2012.out
?? scripts/spikes/bigquery/spot_2010-11-15.csv
?? scripts/spikes/bigquery/spot_2011-06-15.csv
?? scripts/spikes/bigquery/spot_2012-06-15.csv
```

_Generated 2026-10-11T01:02:06Z by scripts/bigquery_history/report.py._

## Final step: "checked, 0 eligible transactions" days (2026-10-11)

- Backup before any change: `scripts/backups/bitflow_20261011T010222Z_before_empty_days.dump` (322642572 bytes, pg_dump custom format; contains all 5 tables, checked with pg_restore --list).
- Migration: `backend/migrations/versions/0002_checked_empty_days.py` (new table `checked_empty_days(day DATE PRIMARY KEY, checked_at TIMESTAMPTZ NOT NULL)`; no existing table or column changed). Applied: alembic 0001 -> 0002.
- Filled from `scripts/bigquery_history/state.json` with `python -m app.ingestion.empty_days_cli --before 2026-10-09`: 260 days recorded (2009-01-03 .. 2010-01-20); second run recorded 0 (no duplicates); 0 overlap with stored days; ingested_days still 6,229.
- API: stored day unchanged; checked-empty day -> 200 `{"transaction_count": 0, "nodes": [], "edges": [], "status": "no_eligible_transactions"}` (detail endpoints 404 with their usual codes); never-loaded day -> existing 404 `day_not_ingested`. /api/days and the default day are unchanged (they list stored days only).
- Tests: 136 passed.
