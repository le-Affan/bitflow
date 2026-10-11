# TEST FIXTURE: real data, trimmed

- `candidates.csv`: two real transactions of 2026-10-09 (ranks 1 and 10 under BitFlow's ranking rule, both in block
  970651), with all their single-address inputs and outputs, taken from the BigQuery spike export
  (`scripts/spikes/bigquery/bq_rank_2026-10-09_v1.csv`), reformatted to the history export's columns.
- `blocks.csv`: real block heights, hashes and timestamps for blocks 970648–970654, fetched from mempool.space on
  2026-10-11 (the BigQuery spike export has no block hashes).

The same two transactions are stored in Postgres from the blockchain.info ingestion of 2026-10-09; the tests check the
adapter produces exactly the same stored data.
