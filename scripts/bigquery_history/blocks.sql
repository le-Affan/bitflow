-- Every block from @start - 10 days to @end + 10 days: height, hash, timestamp. The margin covers core.py's
-- boundary handling (it fetches a few blocks beyond each end of a day; early 2009 had multi-day gaps). Read-only.
SELECT number, `hash`, UNIX_SECONDS(timestamp) AS timestamp_unix
FROM `bigquery-public-data.crypto_bitcoin.blocks`
WHERE timestamp_month BETWEEN DATE_TRUNC(DATE_SUB(@start, INTERVAL 10 DAY), MONTH)
                          AND DATE_TRUNC(DATE_ADD(@end, INTERVAL 10 DAY), MONTH)
  AND timestamp >= TIMESTAMP(DATE_SUB(@start, INTERVAL 10 DAY))
  AND timestamp < TIMESTAMP(DATE_ADD(@end, INTERVAL 11 DAY))
ORDER BY number
