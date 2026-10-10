# BigQuery spike: can `bigquery-public-data.crypto_bitcoin` reproduce BitFlow's ranking?

Date: 2026-10-10 (UTC). Queries and helper scripts: `scripts/spikes/bigquery/`. This document reports findings only and does not recommend a choice.

Labels: **measured** (observed in this spike), **from docs** (Google documentation), **extrapolation** (computed from measured numbers), **unverified**.

## 1. Access

- **Programmatic access works from the BigQuery sandbox** (measured). Both dry runs and real queries ran with the `bq` CLI (2.1.39, gcloud SDK 588.0.0) under the logged-in gcloud account. No billing was needed, and nothing was created in the project.
- Every query was dry-run first. Every real run used `--maximum_bytes_billed` (estimate + 10 % + 10 MiB, capped at the 50 GB guard). Helper: `scripts/spikes/bigquery/bq.sh`; ledger: `ledger.csv`.
- **Python client: unverified.** `google-cloud-bigquery` is not installed, and `~/.config/gcloud/application_default_credentials.json` does not exist (measured), so the Python client would currently have no application-default credentials. Nothing was installed for this spike.

## 2. Schema (measured, from table metadata via `bq show`, no query cost)

All four objects (`transactions`, `blocks`, `inputs`, `outputs`) are **views**; the view definitions are not exposed. `transactions` contains nested, repeated `inputs` and `outputs` records.

| Concept | Field |
|---|---|
| tx id | `transactions.hash` (STRING) |
| block number | `transactions.block_number` (INTEGER) |
| block timestamp | `transactions.block_timestamp` (TIMESTAMP, UTC) |
| partition column | `transactions.block_timestamp_month` (DATE); `blocks.timestamp_month` |
| coinbase flag | `transactions.is_coinbase` (BOOLEAN) |
| input address(es), value, position | `inputs.addresses` (STRING **REPEATED**), `inputs.value` (NUMERIC), `inputs.index` |
| output address(es), value, position | `outputs.addresses` (STRING **REPEATED**), `outputs.value` (NUMERIC), `outputs.index` |

- **Addresses are arrays.**
- **Values:**
  - NUMERIC type, all whole numbers on 2026-10-09: 0 fractional values in 1.17 M inputs and 1.54 M outputs (measured).
  - They are in **satoshis**: they match our stored integer satoshis exactly (measured, section 4).
- **Outputs without a standard address** (measured on 2026-10-09):
  - OP_RETURN (`type = nulldata`): empty array (380,993 outputs).
  - Bare multisig (`type = multisig`): 3 addresses (14 outputs).
  - Coinbase inputs: empty array (146).
  - Nonstandard inputs: empty array (2).
  - No `nonstandard…` placeholder addresses appeared that day.
  - Pay-to-anchor (`anchor`, address `bc1pfeessrawgf`) and `witness_unknown` outputs have exactly one address.
- **Rule used for "has a standard address":** `ARRAY_LENGTH(addresses) = 1`. It reproduces blockchain.info exactly:
  - outputs without an address: 380,993 + 14 = **381,007**, the same as our ingestion counted on 2026-10-09;
  - inputs without an address: **148**, also identical (measured).
- **Partition filtering:**
  - `transactions` is filtered on `block_timestamp_month`. The `inputs` and `outputs` views have no month column and were not used: the nested fields of `transactions` were used instead.
  - Adding a filter on `block_timestamp` for the UTC day lowered the estimate well below the month partition. A one-day query estimated 0.27–0.39 GB, in full past months too, so the day filter prunes inside a partition (measured; probably clustering, unverified).
  - The dry-run estimate equalled the processed bytes for the ranking query. For the counts queries the processed bytes were about 25 % of the estimate (measured).

## 3. Ranking rule in SQL

`scripts/spikes/bigquery/10_rank_day_v1.sql` (parameter `@day`):
- Days and blocks: a UTC day is selected by each block's own `block_timestamp`.
- Inputs and outputs counted: those with exactly one address.
- Outward outputs: addressed outputs whose address is not one of the same transaction's addressed input addresses.
- Eligibility: not coinbase, at least one addressed input and at least one outward output.
- Ranking value: the largest outward output.
- Order: top 100 by `ROW_NUMBER() OVER (ORDER BY rank_value DESC, txid ASC)`.
- Output: one row per stored input or output of each top-100 transaction (txid, block number, block time, ranking value, kind, position, address, value), the same shape as Postgres.

Result, 2026-10-09 (measured):
- 100 transactions.
- 2,055 rows (1,524 inputs, 531 outputs).
- 334,852,339 bytes processed.

## 4. Comparison with Postgres for 2026-10-09 (first pass, no adjustments)

The Postgres day was exported read-only (`20_pg_day_export.sql`), with ranks recomputed by the same rule because rank is not stored. It was compared with `compare_days.py`.

| Check | Result (measured) |
|---|---|
| txids | 100 in BigQuery, 100 in Postgres, **100 matching** |
| rank order | identical (0 differences) |
| ranking values | identical (0 differences) |
| block heights / block times | identical (0 / 0 differences) |
| full input and output sets (address, value, position) | identical for all 100: 1,524 inputs and 531 outputs, 0 differences |

**Adjustments after the first pass: none.** There was nothing to explain. Positions agree: `inputs.index` and `outputs.index` correspond to our original in-transaction index.

## 5. Cross-check on 2026-10-08

**Counts** (`30_day_counts.sql`):

| Count | BigQuery (measured) | blockchain.info spike (measured earlier) |
|---|---:|---:|
| blocks / heights | 139 / 970410–970548 | 139 / 970410–970548 |
| transactions | 630,220 | 630,220 |
| outputs | 1,474,013 | 1,474,013 |
| outputs without an address | 358,051 | 358,051 |
| inputs | 1,125,221 | 1,125,221 |
| inputs without an address | 140 (139 coinbase + 1) | 140 (139 coinbase + 1) |

The same query for 2026-10-09 matches our ingestion summary exactly (measured):

| Count | Value |
|---|---:|
| blocks | 146 (970549–970694) |
| transactions | 657,407 |
| coinbase | 146 |
| no addressed input | 2 |
| no outward output | 365,215 |
| eligible | 292,044 |

**Ranking for 2026-10-08** (measured):
- 100 transactions: 845 inputs, 249 outputs, 368,427,031 bytes processed.
- Ranks 1, 2, 3 and 100 were verified against mempool.space with `scripts/spikes/verify_ranking_against_mempool.py`. All four match on ranking address, ranking value, block height and block time, and the ranking address is not one of the transaction's input addresses on mempool.space.
  - Rank 1: `9194d9de…`, 1,226,702,209,833 sat.
  - Rank 2: `0873c0ff…`, 1,226,702,096,820 sat.
  - Rank 3: `86b5d8b6…`, 926,702,096,252 sat.
  - Rank 100: `c1ae025b…`, 39,079,235,698 sat.
- **Not verified:** that the 2026-10-08 top 100 equals what our blockchain.info ingestion would produce. That day is not stored in Postgres and was not re-ingested.

## 6. Cost scaling

**One query per day** (`10_rank_day_v1.sql`):

| Day | Dry-run estimate | Processed (measured) |
|---|---:|---:|
| 2026-10-09 | 0.335 GB | 0.335 GB |
| 2026-10-08 | 0.368 GB | 0.368 GB |
| 2026-09-15 | 0.387 GB | not run |
| 2026-03-15 | 0.274 GB | not run |
| 2025-10-15 | 0.276 GB | not run |
| 2024-10-15 | 0.316 GB | not run |

**One range query that ranks per day** (`11_rank_range.sql`, `PARTITION BY day`), days ending 2026-10-08, dry runs only:

| Days | Estimate | Per day | Run? |
|---:|---:|---:|---|
| 1 | 0.368 GB | 0.368 GB | — |
| 7 | 1.825 GB | 0.261 GB | not run |
| 30 | 7.077 GB | 0.236 GB | not run |
| 365 | 74.609 GB | 0.204 GB | **not run: over the 50 GB guard** |
| 1,096 (3 years) | 225.651 GB | 0.206 GB | **not run: over the 50 GB guard** |

- **Per day, the range form is cheaper:** about 0.20–0.26 GB per day, against about 0.27–0.39 GB per day for single-day queries (from dry runs).
- **Free quota:** 1 TB of query processing per month (from docs, BigQuery sandbox / free tier).

| Workload | Estimate | Share of 1 TB/month |
|---|---:|---:|
| Monthly daily job, if it ran in BigQuery: 30 × 0.335 GB measured | ≈ 10 GB/month (extrapolation) | ≈ 1 % |
| One-time 1 year, range form | 74.6 GB (dry run) | ≈ 7.5 % |
| One-time 1 year, per-day form: 365 × 0.335 GB | ≈ 122 GB (extrapolation) | ≈ 12 % |
| One-time 3 years, range form | 225.7 GB (dry run) | ≈ 23 % |
| One-time 3 years, per-day form: 1,096 × 0.335 GB | ≈ 367 GB (extrapolation) | ≈ 37 % |

Under the 50 GB guard, a 1-year range would have to be split, for example into monthly ranges of about 6–8 GB each (extrapolation from the 30-day dry run).

## 7. Getting results onto this machine

- **Tested:** `bq query --format=csv --max_rows=1000000` streams the result straight to a local file, with no Cloud Storage bucket and no destination table (results are paged from BigQuery's temporary result table).
- **One day** (measured):

| Day | Rows | File size |
|---|---:|---:|
| 2026-10-09 | 2,055 | 337,554 B |
| 2026-10-08 | 1,094 | 179,538 B |

- **1 year** (extrapolation from 2026-10-09):
  - 36,500 transactions, about 556,260 inputs and 193,815 outputs (about 750,000 rows);
  - CSV about 123 MB. Using 2026-10-08 as the base instead gives about 64 MB.
- **Not tested:** the Python client's paging, and very large single results (a whole year in one query was not run).

## 8. Freshness and handover

- **Latest block** (measured, 22:29:31Z on 2026-10-10): 970837 at 2026-10-10T22:28:37Z. That equals the current tip on both blockchain.info and mempool.space, so the lag was **0 blocks**, about 1 minute after the block's timestamp, at that moment.
- **Coverage:** BigQuery could supply every complete UTC day before 2026-10-09; day selection by block timestamp works the same way in both sources (measured on 2026-10-08 and 2026-10-09).
- **Agreement on the overlap day:** on 2026-10-09 both sources produce identical stored data under the same rule (measured). Using BigQuery for days < 2026-10-09 and blockchain.info from 2026-10-09 leaves no gap and no overlap, as long as each day comes from exactly one source.
- **Risks, unverified:**
  - Older years may contain output types not seen on these two days (for example P2PK `pubkey` outputs, common in 2009–2012, and `nonstandard…` placeholder addresses). Their address representation in BigQuery versus blockchain.info was not compared.
  - The rule "exactly one address" was only validated on 2026-10-08 and 2026-10-09.
  - Reorgs near the tip are irrelevant for history.

## 9. Bytes processed in this spike (measured)

| | |
|---|---|
| Real queries | 6 (plus 1 that failed with no bytes billed) |
| Processed | 1,401,059,551 B (≈ 1.40 GB) |
| Billed | 1,414,529,024 B (≈ 1.41 GB); minimum 10 MiB per query |
| Dry runs | about 15 (free) |

## 10. Could not verify

- Whether the Python BigQuery client works (not installed; no application-default credentials file).
- Address representation in older eras (P2PK, `nonstandard`, early multisig), and whether "exactly one address" still matches blockchain.info there.
- That the 2026-10-08 top 100 equals our own ingestion of that day (not ingested).
- Why the day filter reduces bytes (looks like clustering on `block_timestamp`; the view definitions are hidden).
- Running a full-year range query in one go (over the guard; not run).

## 11. Follow-up: five days across the assumed backfill window (2026-10-11)

**Window:** the 365 days before 2026-10-09 (2025-10-09 to 2026-10-08) is an ASSUMPTION; the PRD does not define a backfill window. Queries: `scripts/spikes/bigquery/50_window_day_profile.sql`, `51_day_types.sql`, `12_rank_summary.sql`.

### Days chosen (measured from the `blocks` view)

| Day | Why | Blocks (heights) | Transactions |
|---|---|---|---:|
| 2025-11-27 | Q4 2025; difficulty adjustment at 925344 | 143 (925343–925485) | 403,825 |
| 2026-01-24 | Q1 2026; quietest day of the window | 98 (933583–933680) | 289,144 |
| 2026-05-15 | Q2 2026; difficulty adjustment at 949536 | 145 (949434–949578) | 618,617 |
| 2026-08-15 | Q3 2026; busy day | 145 (962499–962643) | 719,514 |
| 2026-10-05 | busiest day of the window | 177 (969924–970101; 178 heights, one block's own timestamp is on another day) | 904,518 |

Window profile (measured): median 540,923 transactions per day, minimum 289,144, maximum 904,518; 26 difficulty-adjustment days.

### BigQuery per-day counts (measured)

| Day | Transactions | Outputs | Outputs with 0 addresses | Outputs with 2+ addresses | Inputs | Inputs without exactly one address | Coinbase inputs |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2025-11-27 | 403,825 | 1,034,951 | 126,890 | 2,610 | 1,016,238 | 143 | 143 |
| 2026-01-24 | 289,144 | 756,795 | 77,357 | 260 | 703,553 | 98 | 98 |
| 2026-05-15 | 618,617 | 1,470,125 | 340,287 | 222 | 1,081,514 | 145 | 145 |
| 2026-08-15 | 719,514 | 1,621,021 | 489,098 | 54 | 1,106,818 | 265 (145 coinbase + 120 multisig inputs with 2 addresses) | 145 |
| 2026-10-05 | 904,518 | 2,014,742 | 629,820 | 11 | 1,380,610 | 177 | 177 |

No fractional values and no `nonstandard…` placeholder addresses on any of these days (measured).

### Comparison with blockchain.info

- **NOT VERIFIED: count comparison with blockchain.info, skipped by the user to save time** — 2025-11-27 (stopped after 51 requests, before the day finished).
- **NOT VERIFIED: count comparison with blockchain.info, skipped by the user to save time** — 2026-01-24.
- **NOT VERIFIED: count comparison with blockchain.info, skipped by the user to save time** — 2026-05-15.
- **NOT VERIFIED: count comparison with blockchain.info, skipped by the user to save time** — 2026-08-15.
- **NOT VERIFIED: count comparison with blockchain.info, skipped by the user to save time** — 2026-10-05.

The "exactly one address" rule is therefore **not proven** for these five days. It was matched against blockchain.info only on 2026-10-08 and 2026-10-09 (sections 2 and 5).

### Ranking checks against mempool.space (measured)

Ranks 1, 2, 3 and 100 of each day were checked with `scripts/spikes/verify_ranking_against_mempool.py`. **All 20 match**: the ranking output's address and value, the block height and block time, and the ranking address is not one of the transaction's inputs on mempool.space.

| Day | Rank 1 | Rank 2 | Rank 3 | Rank 100 | Eligible |
|---|---|---|---|---|---:|
| 2025-11-27 | `31fedbfe…` 500,000,000,000 | `c92f9f4e…` 500,000,000,000 | `d2bdfa69…` 215,117,425,531 | `43566b03…` 31,204,097,304 | 288,064 |
| 2026-01-24 | `adf3116c…` 229,091,085,159 | `2263086a…` 152,500,000,000 | `e46b3cab…` 80,603,703,600 | `08e2068b…` 9,968,676,942 | 229,160 |
| 2026-05-15 | `fa206542…` 216,469,560,939 | `d0c71a51…` 214,787,821,554 | `f713caf1…` 213,421,034,772 | `264fb563…` 45,274,566,999 | 287,418 |
| 2026-08-15 | `32781541…` 150,000,000,000 | `69a4760e…` 90,616,977,400 | `efeeed88…` 89,047,733,000 | `1cd17542…` 9,700,086,389 | 238,810 |
| 2026-10-05 | `b6e80f07…` 447,000,842,805 | `c8bbc7c2…` 250,000,000,000 | `64ca90b1…` 177,769,752,055 | `a6f49e99…` 25,056,126,255 | 294,045 |

These checks confirm the ranking output per transaction against a third source. They do not confirm that blockchain.info would choose the same top 100, which was only shown for 2026-10-09.

### Ties (measured)

- **No tie straddles rank 100 on any of the five days:** rank 100's ranking value is unique every day.
- **2025-11-27:** ranks 1 and 2 are tied at exactly 500,000,000,000 sat (5,000 BTC). The txid tiebreak orders them `31fedbfe…` before `c92f9f4e…` (ascending). The same day has a group of 4 at 35,000,000,000 sat (ranks 90–93), also in ascending txid order.
- **Other groups,** all fully inside or fully outside the top 100 and in ascending txid order:
  - 2026-05-15: 2 tied at ranks 97–98, and 2 at ranks 108–109.
  - 2026-10-05: 7 tied at 30,000,000,000 sat, ending at rank 91; 3 at ranks 107–109.

### Script types seen (measured, BigQuery `type` field)

| Representation | Types |
|---|---|
| Exactly one address (counts as a standard address) | `pubkeyhash`, `scripthash`, `witness_v0_keyhash`, `witness_v0_scripthash`, `witness_v1_taproot`, `anchor` (pay-to-anchor, address `bc1pfeessrawgf`), `witness_unknown` (outputs), `pubkey` (6 inputs on 2026-08-15) |
| Zero addresses | `nulldata` (OP_RETURN outputs), coinbase inputs (`type` NULL), `nonstandard` inputs |
| Two or more addresses (counts as no address) | `multisig` (bare multisig, outputs and inputs) |

- **Matched against blockchain.info on 2026-10-08/09:** only `nulldata` and `multisig` as "no address", and `anchor` and `witness_unknown` as "one address". The totals matched exactly on those days.
- **Never compared:** `pubkey` (P2PK) and the 2+ address `multisig` inputs.

### Python access (measured)

- In a throwaway venv (since deleted), `google-cloud-bigquery` 3.46.1 installs, but `bigquery.Client()` fails with **`DefaultCredentialsError`**: "Your default credentials were not found."
- **Needs:** `gcloud auth application-default login`, which writes `~/.config/gcloud/application_default_credentials.json`; that file does not exist on this machine now.
- **Backend container:** has neither the library nor any credentials, and runs as a non-root user. Using it would need the package and a credentials mount. Not done.

### Bytes this month (measured)

| Source | Queries | Processed | Billed |
|---|---:|---:|---:|
| This follow-up (`ledger2.csv`) | 11 | 3.204 GB | 3.218 GB |
| Earlier spike (`ledger.csv`) | 6 | 1.401 GB | 1.415 GB |
| **Project job history, this month** | 25 | | **4.701 GB** |
