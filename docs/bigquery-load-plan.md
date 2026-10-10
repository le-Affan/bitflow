# BigQuery history load: free-quota cost plan

Date: 2026-10-11. Dry runs only: no real query was run for this plan, so it used 0 bytes. Query: `scripts/spikes/bigquery/11_rank_range.sql` (the BitFlow ranking rule over a date range, ranked per UTC day; the cheapest form found in `docs/bigquery-spike.md`). Raw numbers: `scripts/spikes/bigquery/plan_years.csv` and `plan_months.csv`.

Labels: **measured** (dry-run estimate or job statistics), **from docs**, **extrapolation**. This document reports a plan of costs; it does not decide whether or when to load.

**Assumptions:**
- The history to load is everything before 2026-10-09, starting at the genesis block day (2009-01-03).
- Years are loaded newest first.
- "1 TB monthly quota" is the BigQuery free tier of 1 TB of query processing per month (from docs).
- The stopping point of 800 GB is the user's choice.

## Starting point

- **Already used this month:** 4.701 GB billed (measured: project job history, 25 query jobs, all from the BigQuery spike).
- **How reliable the estimates are:** in the spike, the processed bytes equalled the dry-run estimate for the per-day ranking query on 2026-10-08 and 2026-10-09 (measured). Whether a year-long range query processes exactly its estimate is not verified.

## Per-year estimate (newest first)

| Year | Days | Estimated GB | Cumulative GB (incl. 4.7 GB used) | % of 1 TB | Under 800 GB? |
|---|---|---:|---:|---:|---|
| 2026 | 2026-01-01 – 2026-10-08 | 58.5 (measured, dry run) | 63.2 | 6.3 % | yes |
| 2025 | full year | 69.5 (measured, dry run) | 132.7 | 13.3 % | yes |
| 2024 | full year | 79.5 (measured, dry run) | 212.2 | 21.2 % | yes |
| 2023 | full year | 68.7 (measured, dry run) | 280.9 | 28.1 % | yes |
| 2022 | full year | 47.5 (measured, dry run) | 328.4 | 32.8 % | yes |
| 2021 | full year | 47.1 (measured, dry run) | 375.5 | 37.5 % | yes |
| 2020 | full year | 46.4 (measured, dry run) | 421.9 | 42.2 % | yes |
| 2019 | full year | 44.1 (measured, dry run) | 466.0 | 46.6 % | yes |
| 2018 | full year | 34.0 (measured, dry run) | 500.0 | 50.0 % | yes |
| 2017 | full year | 40.3 (measured, dry run) | 540.4 | 54.0 % | yes |
| 2016 | full year | 32.4 (measured, dry run) | 572.8 | 57.3 % | yes |
| 2015 | full year | 20.9 (measured, dry run) | 593.7 | 59.4 % | yes |
| 2014 | full year | 11.3 (measured, dry run) | 605.0 | 60.5 % | yes |
| 2013 | full year | 7.5 (measured, dry run) | 612.5 | 61.3 % | yes |
| 2012 | full year | 3.1 (measured, dry run) | 615.6 | 61.6 % | yes |
| 2011 | full year | 0.7 (measured, dry run) | 616.3 | 61.6 % | yes |
| 2010 | full year | 0.1 (measured, dry run) | 616.4 | 61.6 % | yes |
| 2009 | 2009-01-03 – 2009-12-31 | 0.07 (measured, dry run) | 616.5 | 61.6 % | yes |
| **All** | 2009-01-03 – 2026-10-08 | **611.8** (sum of dry runs) | **616.5** | **61.6 %** | yes |

- **800 GB stopping point:** never reached. On these estimates the whole history plus this month's usage comes to about 616.5 GB, so every year fits this month. No year is left for next month (extrapolation from the dry runs; actual processed bytes may differ).
- **Margin:** with the monthly chunks below for 2023–2026, the total rises by about 5 GB, to about 621.7 GB (measured, sum of monthly dry runs), still under 800 GB. Even a 25 % overrun on every estimate would be about 769 GB, also under 800 GB (extrapolation).

## Queries above the 50 GB single-query guard

Four single-year queries exceed the guard: **2026 (58.5 GB), 2025 (69.5 GB), 2024 (79.5 GB), 2023 (68.7 GB).** Proposed chunks are one query per calendar month. Monthly dry-run estimates in GB (measured):

| Year | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Sum |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026 | 5.4 | 5.6 | 6.1 | 6.1 | 6.9 | 6.7 | 6.9 | 7.0 | 7.0 | 2.0 (to 10-08) | — | — | 59.7 |
| 2025 | 5.9 | 5.7 | 6.2 | 5.8 | 5.9 | 5.0 | 6.0 | 6.3 | 6.1 | 6.1 | 5.8 | 6.1 | 70.8 |
| 2024 | 6.8 | 5.5 | 6.1 | 6.8 | 7.1 | 6.8 | 7.5 | 7.0 | 6.7 | 7.7 | 6.8 | 6.1 | 80.9 |
| 2023 | 4.4 | 4.1 | 4.7 | 5.1 | 6.9 | 5.6 | 6.3 | 6.4 | 6.4 | 5.6 | 7.0 | 7.5 | 70.0 |

- The largest monthly chunk is 7.7 GB (2024-10), far under the guard.
- Monthly sums are about 1–2 % above the one-year estimate, because each query pays its own fixed scan overhead.
- All other years are under 50 GB as single-year queries; months could still be used to keep each result small.

## Risky years: representations never compared with blockchain.info

The "exactly one address" rule and the ranking were matched against blockchain.info only on **2026-10-08 and 2026-10-09** (`docs/bigquery-spike.md`, sections 4–5). Five more days of 2025–2026 were checked against mempool.space for ranks 1, 2, 3 and 100, but their counts were **not** compared with blockchain.info (section 11).

| Years | Why risky (not verified) |
|---|---|
| **2009–2012** (highest risk, every year before 2013) | Pay-to-public-key (P2PK, `pubkey`) outputs were common. BigQuery gives them one address; how blockchain.info represents them (address or none) was never compared. A mismatch would change eligibility and ranking. `nonstandard` outputs and placeholder addresses may also appear. |
| **2013–2016** | Bare `multisig` outputs (data-embedding schemes) and early OP_RETURN usage; the 2+ address handling was compared only on 2026-10-08/09, with 14 multisig outputs. |
| **2017–2022** | SegWit types appear from 2017 and taproot from late 2021. They were seen only in 2025–2026 samples; per-year representation was not compared. |
| **2023–2026-10-08** | Closest to the verified days, with the same type set as the 2025–2026 samples. The counts still match blockchain.info only on 2026-10-08/09. |

Comparing at least one sampled day per risky period against blockchain.info, as in `docs/bigquery-spike.md` section 5, would close these gaps. It was not done.

## Not verified

- That real processed bytes equal the dry-run estimates for year-long or month-long range queries (only verified for single days).
- The free-tier quota (1 TB/month) and how the sandbox counts it, beyond Google's documentation.
- Representation and ranking equality with blockchain.info for any year other than 2026 (only 2026-10-08/09 were compared).
- Export size and duration for a full year or the full history (extrapolated in `docs/bigquery-spike.md` from one day only).
