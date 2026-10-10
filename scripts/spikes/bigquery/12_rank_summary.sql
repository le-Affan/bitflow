-- Same ranking rule as 10_rank_day_v1.sql, summary form: ranks 1..110 with the ranking output's address and tie info.
-- First version (v1): an address counts as standard when the addresses array has exactly one element.
-- Output: one row per stored input/output of each top-100 transaction (kind = 'in' / 'out'), same shape as Postgres.
WITH tx AS (
  SELECT `hash` AS txid, block_number, block_timestamp, is_coinbase, inputs, outputs
  FROM `bigquery-public-data.crypto_bitcoin.transactions`
  WHERE block_timestamp_month = DATE_TRUNC(@day, MONTH)                 -- partition filter
    AND block_timestamp >= TIMESTAMP(@day)                              -- the block's own timestamp, UTC day
    AND block_timestamp < TIMESTAMP(DATE_ADD(@day, INTERVAL 1 DAY))
),
ins AS (
  SELECT t.txid, i.index AS position, i.addresses[OFFSET(0)] AS address, i.value
  FROM tx t, UNNEST(t.inputs) i
  WHERE ARRAY_LENGTH(i.addresses) = 1
),
outs AS (
  SELECT t.txid, o.index AS position, o.addresses[OFFSET(0)] AS address, o.value
  FROM tx t, UNNEST(t.outputs) o
  WHERE ARRAY_LENGTH(o.addresses) = 1
),
outward AS (  -- addressed outputs to an address that is not one of the same transaction's input addresses
  SELECT o.* FROM outs o
  LEFT JOIN (SELECT DISTINCT txid, address FROM ins) i ON i.txid = o.txid AND i.address = o.address
  WHERE i.txid IS NULL
),
ranked AS (
  SELECT t.txid, t.block_number, t.block_timestamp, MAX(w.value) AS rank_value,
         ARRAY_AGG(w.address ORDER BY w.value DESC, w.position LIMIT 1)[OFFSET(0)] AS rank_address
  FROM tx t
  JOIN outward w ON w.txid = t.txid
  WHERE NOT t.is_coinbase
    AND t.txid IN (SELECT txid FROM ins)
  GROUP BY t.txid, t.block_number, t.block_timestamp
),
numbered AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY rank_value DESC, txid ASC) AS rank,
         COUNT(*) OVER (PARTITION BY rank_value) AS same_value_count,
         COUNT(*) OVER () AS eligible_total
  FROM ranked
)
SELECT rank, txid, block_number, UNIX_SECONDS(block_timestamp) AS block_time_unix, CAST(rank_value AS STRING) AS rank_value_sat,
       rank_address, same_value_count, eligible_total
FROM numbered
WHERE rank <= 110
ORDER BY rank
