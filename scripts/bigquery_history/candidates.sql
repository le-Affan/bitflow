-- Ranking candidates for every UTC day in [@start, @end] (DATE parameters), BitFlow's ranking rule evaluated in
-- BigQuery exactly as in docs/BitFlow_PRD.md "Ranking update" and verified in docs/bigquery-spike.md:
--   standard address = exactly one address; outward output = output whose address is not one of the same
--   transaction's input addresses; eligible = not coinbase, >= 1 addressed input, >= 1 outward output;
--   ranking value = largest outward output; order by value desc, txid asc.
-- Returns the top 110 per day (core.py re-ranks and keeps 100), one row per single-address input/output.
-- A block belongs to the UTC day of its own timestamp.
WITH tx AS (
  SELECT `hash` AS txid, block_number, block_timestamp, DATE(block_timestamp) AS day, is_coinbase, inputs, outputs
  FROM `bigquery-public-data.crypto_bitcoin.transactions`
  WHERE block_timestamp_month BETWEEN DATE_TRUNC(@start, MONTH) AND DATE_TRUNC(@end, MONTH)
    AND block_timestamp >= TIMESTAMP(@start)
    AND block_timestamp < TIMESTAMP(DATE_ADD(@end, INTERVAL 1 DAY))
),
ins AS (
  SELECT t.txid, i.index AS position, i.addresses[SAFE_OFFSET(0)] AS address, i.value
  FROM tx t, UNNEST(t.inputs) i
  WHERE ARRAY_LENGTH(i.addresses) = 1
),
outs AS (
  SELECT t.txid, o.index AS position, o.addresses[SAFE_OFFSET(0)] AS address, o.value
  FROM tx t, UNNEST(t.outputs) o
  WHERE ARRAY_LENGTH(o.addresses) = 1
),
outward AS (
  SELECT o.* FROM outs o
  LEFT JOIN (SELECT DISTINCT txid, address FROM ins) i ON i.txid = o.txid AND i.address = o.address
  WHERE i.txid IS NULL
),
ranked AS (
  SELECT t.day, t.txid, t.block_number, t.block_timestamp, MAX(w.value) AS rank_value
  FROM tx t
  JOIN outward w ON w.txid = t.txid
  WHERE NOT t.is_coinbase
    AND t.txid IN (SELECT txid FROM ins)
  GROUP BY t.day, t.txid, t.block_number, t.block_timestamp
),
top AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY day ORDER BY rank_value DESC, txid ASC) AS rank
  FROM ranked
  QUALIFY rank <= 110
)
SELECT CAST(top.day AS STRING) AS day, top.rank, top.txid, top.block_number,
       UNIX_SECONDS(top.block_timestamp) AS block_time_unix, r.kind, r.position, r.address,
       CAST(r.value AS STRING) AS value_sat
FROM top
JOIN (
  SELECT 'in' AS kind, txid, position, address, value FROM ins
  UNION ALL
  SELECT 'out' AS kind, txid, position, address, value FROM outs
) r ON r.txid = top.txid
ORDER BY top.day, top.rank, r.kind, r.position
