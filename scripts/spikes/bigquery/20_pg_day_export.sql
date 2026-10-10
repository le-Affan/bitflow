-- Read-only export of a stored day from Postgres in the same shape as the BigQuery ranking result.
-- Ranks are recomputed with the same rule (largest outward output, ties by txid) since rank is not stored.
COPY (
  WITH rank_out AS (
    SELECT DISTINCT ON (t.txid) t.txid, o.value_sat AS rank_value_sat
    FROM transactions t JOIN tx_outputs o ON o.day = t.day AND o.txid = t.txid
    WHERE t.day = :'day'
      AND NOT EXISTS (SELECT 1 FROM tx_inputs i WHERE i.day = t.day AND i.txid = t.txid AND i.address = o.address)
    ORDER BY t.txid, o.value_sat DESC
  ),
  ranked AS (SELECT txid, rank_value_sat, row_number() OVER (ORDER BY rank_value_sat DESC, txid) AS rank FROM rank_out),
  rows AS (
    SELECT 'in' AS kind, txid, position, address, value_sat FROM tx_inputs WHERE day = :'day'
    UNION ALL
    SELECT 'out', txid, position, address, value_sat FROM tx_outputs WHERE day = :'day'
  )
  SELECT r.rank, t.txid, t.block_height AS block_number,
         to_char(t.block_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS block_time,
         r.rank_value_sat, x.kind, x.position, x.address, x.value_sat
  FROM transactions t JOIN ranked r USING (txid) JOIN rows x USING (txid)
  WHERE t.day = :'day'
  ORDER BY r.rank, x.kind, x.position
) TO STDOUT WITH (FORMAT csv, HEADER true);
