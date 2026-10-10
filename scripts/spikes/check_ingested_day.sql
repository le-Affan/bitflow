-- Independent checks on a stored day, written without app code. Throwaway.
-- Run: docker compose exec -T postgres psql -U bitflow -d bitflow -v day="'2026-10-09'" -f - < scripts/spikes/check_ingested_day.sql

\echo '== ingested_days'
SELECT day, status, ingested_at, transaction_count FROM ingested_days WHERE day = :day;

\echo '== counts'
SELECT (SELECT count(*) FROM transactions WHERE day = :day) AS txs,
       (SELECT count(*) FROM tx_inputs  WHERE day = :day) AS inputs,
       (SELECT count(*) FROM tx_outputs WHERE day = :day) AS outputs,
       (SELECT min(block_height) FROM transactions WHERE day = :day) AS min_height,
       (SELECT max(block_height) FROM transactions WHERE day = :day) AS max_height,
       (SELECT count(DISTINCT block_height) FROM transactions WHERE day = :day) AS blocks_with_stored_txs;

\echo '== (b) block times outside the UTC day (expect 0)'
SELECT count(*) AS txs, min(block_time) AS min_time, max(block_time) AS max_time
FROM transactions
WHERE day = :day;
SELECT count(*) AS outside_day
FROM transactions
WHERE day = :day
  AND NOT (block_time >= (:day::date)::timestamp AT TIME ZONE 'UTC'
       AND block_time <  ((:day::date) + 1)::timestamp AT TIME ZONE 'UTC');

\echo '== (c) txs without any input or output (coinbase-like) and txs with zero edges (expect 0, 0)'
SELECT count(*) AS no_inputs FROM transactions t
WHERE day = :day AND NOT EXISTS (SELECT 1 FROM tx_inputs i WHERE i.day = t.day AND i.txid = t.txid);
SELECT count(*) AS no_outputs FROM transactions t
WHERE day = :day AND NOT EXISTS (SELECT 1 FROM tx_outputs o WHERE o.day = t.day AND o.txid = t.txid);
WITH e AS (
  SELECT DISTINCT i.txid, i.address AS src, o.address AS dst
  FROM tx_inputs i JOIN tx_outputs o ON o.day = i.day AND o.txid = i.txid
  WHERE i.day = :day AND i.address <> o.address
)
SELECT count(*) AS zero_edge_txs FROM transactions t
WHERE day = :day AND NOT EXISTS (SELECT 1 FROM e WHERE e.txid = t.txid);

\echo '== ranking values: top 5 and rank 100 (largest addressed output per tx)'
WITH r AS (
  SELECT t.txid, t.block_height, t.block_time, max(o.value_sat) AS rank_value_sat
  FROM transactions t JOIN tx_outputs o ON o.day = t.day AND o.txid = t.txid
  WHERE t.day = :day GROUP BY t.txid, t.block_height, t.block_time
), n AS (SELECT r.*, row_number() OVER (ORDER BY rank_value_sat DESC, txid) AS rank FROM r)
SELECT rank, txid, block_height, block_time, rank_value_sat FROM n WHERE rank <= 5 OR rank >= 99 ORDER BY rank;

\echo '== graph size'
WITH pairs AS (
  SELECT DISTINCT i.txid, i.address AS src, o.address AS dst
  FROM tx_inputs i JOIN tx_outputs o ON o.day = i.day AND o.txid = i.txid
  WHERE i.day = :day AND i.address <> o.address
)
SELECT (SELECT count(*) FROM pairs) AS edges_before_aggregation,
       (SELECT count(*) FROM (SELECT DISTINCT src, dst FROM pairs) x) AS edges_after_aggregation,
       (SELECT count(*) FROM (SELECT src AS a FROM pairs UNION SELECT dst FROM pairs) x) AS nodes_in_edges,
       (SELECT count(*) FROM (SELECT address FROM tx_inputs WHERE day = :day
                              UNION SELECT address FROM tx_outputs WHERE day = :day) x) AS distinct_stored_addresses;

\echo '== 5 transactions producing the most edges'
WITH pairs AS (
  SELECT DISTINCT i.txid, i.address AS src, o.address AS dst
  FROM tx_inputs i JOIN tx_outputs o ON o.day = i.day AND o.txid = i.txid
  WHERE i.day = :day AND i.address <> o.address
)
SELECT p.txid, count(*) AS edges,
       (SELECT count(DISTINCT address) FROM tx_inputs  WHERE day = :day AND txid = p.txid) AS distinct_in_addrs,
       (SELECT count(DISTINCT address) FROM tx_outputs WHERE day = :day AND txid = p.txid) AS distinct_out_addrs
FROM pairs p GROUP BY p.txid ORDER BY edges DESC, p.txid LIMIT 5;
