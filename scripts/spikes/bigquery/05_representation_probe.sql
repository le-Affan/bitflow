-- How addresses and values are represented on one UTC day (parameter @day). Read-only.
WITH tx AS (
  SELECT `hash` AS txid, is_coinbase, inputs, outputs
  FROM `bigquery-public-data.crypto_bitcoin.transactions`
  WHERE block_timestamp_month = DATE_TRUNC(@day, MONTH)
    AND block_timestamp >= TIMESTAMP(@day) AND block_timestamp < TIMESTAMP(DATE_ADD(@day, INTERVAL 1 DAY))
)
SELECT 'out' AS side, o.type, ARRAY_LENGTH(o.addresses) AS n_addr,
       COUNTIF(EXISTS (SELECT 1 FROM UNNEST(o.addresses) a WHERE STARTS_WITH(a, 'nonstandard'))) AS nonstandard_prefixed,
       COUNT(*) AS n, COUNTIF(o.value != TRUNC(o.value)) AS fractional_values,
       ANY_VALUE(o.addresses[SAFE_OFFSET(0)]) AS sample_address, MIN(o.value) AS min_value, MAX(o.value) AS max_value
FROM tx t, UNNEST(t.outputs) o GROUP BY side, o.type, n_addr
UNION ALL
SELECT 'in', i.type, ARRAY_LENGTH(i.addresses),
       COUNTIF(EXISTS (SELECT 1 FROM UNNEST(i.addresses) a WHERE STARTS_WITH(a, 'nonstandard'))),
       COUNT(*), COUNTIF(i.value != TRUNC(i.value)), ANY_VALUE(i.addresses[SAFE_OFFSET(0)]), MIN(i.value), MAX(i.value)
FROM tx t, UNNEST(t.inputs) i GROUP BY 1, 2, 3
UNION ALL
SELECT 'tx', CAST(is_coinbase AS STRING), ARRAY_LENGTH(inputs), 0, COUNT(*), 0, NULL, NULL, NULL FROM tx GROUP BY 2, 3
ORDER BY side, n DESC
