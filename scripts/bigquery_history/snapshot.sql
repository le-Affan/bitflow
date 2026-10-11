-- Read-only snapshot of stored days: one row per day with ingestion time, counts and a content checksum.
SELECT d.day, d.ingested_at, d.transaction_count,
       (SELECT count(*) FROM tx_inputs i WHERE i.day = d.day) AS inputs,
       (SELECT count(*) FROM tx_outputs o WHERE o.day = d.day) AS outputs,
       md5(coalesce((SELECT string_agg(t.txid || ':' || t.block_height, ',' ORDER BY t.txid) FROM transactions t WHERE t.day = d.day), '')
           || coalesce((SELECT string_agg(i.txid || i.position || i.address || i.value_sat, ',' ORDER BY i.txid, i.position) FROM tx_inputs i WHERE i.day = d.day), '')
           || coalesce((SELECT string_agg(o.txid || o.position || o.address || o.value_sat, ',' ORDER BY o.txid, o.position) FROM tx_outputs o WHERE o.day = d.day), '')) AS checksum
FROM ingested_days d ORDER BY d.day;
