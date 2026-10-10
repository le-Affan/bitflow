-- Per-day counts for cross-checking against blockchain.info measurements. Parameter @day (DATE). Read-only.
WITH tx AS (
  SELECT `hash` AS txid, block_number, is_coinbase, inputs, outputs
  FROM `bigquery-public-data.crypto_bitcoin.transactions`
  WHERE block_timestamp_month = DATE_TRUNC(@day, MONTH)
    AND block_timestamp >= TIMESTAMP(@day) AND block_timestamp < TIMESTAMP(DATE_ADD(@day, INTERVAL 1 DAY))
),
per_tx AS (
  SELECT txid, is_coinbase,
    (SELECT COUNT(*) FROM UNNEST(inputs)) AS n_in,
    (SELECT COUNTIF(ARRAY_LENGTH(i.addresses) = 1) FROM UNNEST(inputs) i) AS n_in_addr,
    (SELECT COUNT(*) FROM UNNEST(outputs)) AS n_out,
    (SELECT COUNTIF(ARRAY_LENGTH(o.addresses) = 1) FROM UNNEST(outputs) o) AS n_out_addr,
    (SELECT COUNTIF(ARRAY_LENGTH(o.addresses) = 1 AND o.addresses[SAFE_OFFSET(0)] NOT IN
       (SELECT i.addresses[SAFE_OFFSET(0)] FROM UNNEST(inputs) i WHERE ARRAY_LENGTH(i.addresses) = 1)) FROM UNNEST(outputs) o) AS n_outward
  FROM tx
)
SELECT
  (SELECT COUNT(DISTINCT block_number) FROM tx) AS blocks,
  (SELECT MIN(block_number) FROM tx) AS min_block,
  (SELECT MAX(block_number) FROM tx) AS max_block,
  COUNT(*) AS transactions,
  SUM(n_out) AS outputs,
  SUM(n_out - n_out_addr) AS outputs_without_address,
  SUM(n_in) AS inputs,
  SUM(n_in - n_in_addr) AS inputs_without_address,
  COUNTIF(is_coinbase) AS coinbase_txs,
  COUNTIF(NOT is_coinbase AND n_in_addr = 0) AS no_addressed_input,
  COUNTIF(NOT is_coinbase AND n_in_addr > 0 AND n_outward = 0) AS no_outward_output,
  COUNTIF(NOT is_coinbase AND n_in_addr > 0 AND n_outward > 0) AS eligible
FROM per_tx
