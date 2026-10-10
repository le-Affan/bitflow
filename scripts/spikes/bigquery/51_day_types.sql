-- Per-day counts by side ('out' / 'in'), script type and number of addresses, plus totals. Parameter @day. Read-only.
WITH tx AS (
  SELECT `hash` AS txid, block_number, is_coinbase, inputs, outputs
  FROM `bigquery-public-data.crypto_bitcoin.transactions`
  WHERE block_timestamp_month = DATE_TRUNC(@day, MONTH)
    AND block_timestamp >= TIMESTAMP(@day) AND block_timestamp < TIMESTAMP(DATE_ADD(@day, INTERVAL 1 DAY))
)
SELECT 'out' AS side, IFNULL(o.type, 'NULL') AS type, ARRAY_LENGTH(o.addresses) AS n_addr, COUNT(*) AS n,
       COUNTIF(EXISTS (SELECT 1 FROM UNNEST(o.addresses) a WHERE STARTS_WITH(a, 'nonstandard'))) AS nonstandard_prefixed,
       COUNTIF(o.value != TRUNC(o.value)) AS fractional
FROM tx t, UNNEST(t.outputs) o GROUP BY 1, 2, 3
UNION ALL
SELECT 'in', IFNULL(i.type, 'NULL'), ARRAY_LENGTH(i.addresses), COUNT(*),
       COUNTIF(EXISTS (SELECT 1 FROM UNNEST(i.addresses) a WHERE STARTS_WITH(a, 'nonstandard'))),
       COUNTIF(i.value != TRUNC(i.value))
FROM tx t, UNNEST(t.inputs) i GROUP BY 1, 2, 3
UNION ALL
SELECT 'coinbase_inputs', 'all', -1, SUM(ARRAY_LENGTH(inputs)), 0, 0 FROM tx WHERE is_coinbase
UNION ALL
SELECT 'transactions', 'all', -1, COUNT(*), 0, 0 FROM tx
UNION ALL
SELECT 'blocks', CONCAT(CAST(MIN(block_number) AS STRING), '-', CAST(MAX(block_number) AS STRING)), -1, COUNT(DISTINCT block_number), 0, 0 FROM tx
ORDER BY side, n DESC
