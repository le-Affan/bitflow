-- Access test: tiny query on one month partition of the transactions table.
SELECT `hash`, block_number, block_timestamp
FROM `bigquery-public-data.crypto_bitcoin.transactions`
WHERE block_timestamp_month = '2026-10-01'
LIMIT 1
