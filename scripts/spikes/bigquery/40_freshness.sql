-- Latest block in the dataset (current month partition of the blocks view). Read-only.
SELECT MAX(number) AS latest_block, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(timestamp)) AS latest_block_time,
       COUNT(*) AS blocks_this_month, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', CURRENT_TIMESTAMP()) AS queried_at
FROM `bigquery-public-data.crypto_bitcoin.blocks`
WHERE timestamp_month = DATE_TRUNC(CURRENT_DATE(), MONTH)
