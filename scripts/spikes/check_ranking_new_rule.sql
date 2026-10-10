-- Independent checks of the "outward output" ranking on a stored day, in plain SQL (no app code). Throwaway.
-- Run: docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v day="'"'"'2026-10-09'"'"'" -f -' < scripts/spikes/check_ranking_new_rule.sql

\echo '== ranking output per stored tx: largest output whose address is not one of the tx''s input addresses'
CREATE TEMP VIEW rank_out AS
SELECT DISTINCT ON (t.txid) t.txid, t.block_height, t.block_time, o.address AS rank_address, o.value_sat AS rank_value_sat, o.position
FROM transactions t
JOIN tx_outputs o ON o.day = t.day AND o.txid = t.txid
WHERE t.day = :day
  AND NOT EXISTS (SELECT 1 FROM tx_inputs i WHERE i.day = t.day AND i.txid = t.txid AND i.address = o.address)
ORDER BY t.txid, o.value_sat DESC, o.position;

CREATE TEMP VIEW ranked AS
SELECT row_number() OVER (ORDER BY rank_value_sat DESC, txid) AS rank, * FROM rank_out;

\echo '== (c) every stored tx has an outward ranking output, and that address is not among its stored inputs (expect 100, 0, 0)'
SELECT (SELECT count(*) FROM rank_out) AS txs_with_outward_output,
       (SELECT count(*) FROM transactions WHERE day = :day AND txid NOT IN (SELECT txid FROM rank_out)) AS txs_without,
       (SELECT count(*) FROM rank_out r WHERE EXISTS (
          SELECT 1 FROM tx_inputs i WHERE i.day = :day AND i.txid = r.txid AND i.address = r.rank_address)) AS rank_output_is_input_address;

\echo '== (b) block times outside the UTC day (expect 0)'
SELECT count(*) AS outside_day, min(block_time) AS min_time, max(block_time) AS max_time FROM transactions
WHERE day = :day AND NOT (block_time >= (:day::date)::timestamp AT TIME ZONE 'UTC'
                          AND block_time < ((:day::date) + 1)::timestamp AT TIME ZONE 'UTC');

\echo '== txs whose overall largest stored output goes back to an input address (they now rank by a smaller payment)'
SELECT count(*) AS largest_output_is_change FROM transactions t
WHERE t.day = :day AND EXISTS (
  SELECT 1 FROM tx_outputs o
  WHERE o.day = t.day AND o.txid = t.txid
    AND o.value_sat = (SELECT max(value_sat) FROM tx_outputs o2 WHERE o2.day = t.day AND o2.txid = t.txid)
    AND EXISTS (SELECT 1 FROM tx_inputs i WHERE i.day = t.day AND i.txid = t.txid AND i.address = o.address));

\echo '== top 10 and rank 100 (new rule)'
SELECT rank, txid, block_height, block_time, rank_address, rank_value_sat FROM ranked WHERE rank <= 10 OR rank = 100 ORDER BY rank;

\echo '== item 7 (heuristic only): exactly two stored (addressed) outputs and the ranking output is the larger one'
WITH two AS (
  SELECT r.rank, r.txid, r.rank_value_sat,
         array_agg(o.value_sat ORDER BY o.position) AS output_values, count(*) AS n
  FROM ranked r JOIN tx_outputs o ON o.day = :day AND o.txid = r.txid
  GROUP BY r.rank, r.txid, r.rank_value_sat
)
SELECT count(*) FILTER (WHERE n = 2 AND rank_value_sat = (SELECT max(v) FROM unnest(output_values) v)) AS two_outputs_rank_is_larger,
       count(*) FILTER (WHERE n = 2) AS two_outputs_total
FROM two;
WITH two AS (
  SELECT r.rank, r.txid, r.rank_value_sat,
         array_agg(o.value_sat ORDER BY o.position) AS output_values, count(*) AS n
  FROM ranked r JOIN tx_outputs o ON o.day = :day AND o.txid = r.txid
  GROUP BY r.rank, r.txid, r.rank_value_sat
)
SELECT rank, txid, output_values, rank_value_sat FROM two
WHERE n = 2 AND rank_value_sat = (SELECT max(v) FROM unnest(output_values) v)
ORDER BY rank LIMIT 5;
