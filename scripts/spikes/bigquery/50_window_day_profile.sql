-- Per-UTC-day block and transaction counts over the assumed backfill window [@start, @end], plus difficulty
-- adjustment heights (multiples of 2016). Uses the small blocks view only. Read-only.
SELECT DATE(timestamp) AS day, COUNT(*) AS blocks, SUM(transaction_count) AS transactions,
       MIN(number) AS min_height, MAX(number) AS max_height,
       STRING_AGG(IF(MOD(number, 2016) = 0, CAST(number AS STRING), NULL)) AS retarget_heights
FROM `bigquery-public-data.crypto_bitcoin.blocks`
WHERE timestamp_month BETWEEN DATE_TRUNC(@start, MONTH) AND DATE_TRUNC(@end, MONTH)
  AND timestamp >= TIMESTAMP(@start) AND timestamp < TIMESTAMP(DATE_ADD(@end, INTERVAL 1 DAY))
GROUP BY day
ORDER BY day
