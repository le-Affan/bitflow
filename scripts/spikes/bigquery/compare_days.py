"""Compare a BigQuery ranking result with the Postgres export (same CSV shape). Throwaway."""
import csv
import sys
from collections import defaultdict


def load(path):
    txs, parts = {}, defaultdict(set)
    for r in csv.DictReader(open(path)):
        txs[r["txid"]] = (int(r["rank"]), int(r["block_number"]), r["block_time"], int(r["rank_value_sat"]))
        parts[r["txid"]].add((r["kind"], int(r["position"]), r["address"], int(r["value_sat"])))
    return txs, parts


bq_tx, bq_parts = load(sys.argv[1])
pg_tx, pg_parts = load(sys.argv[2])
common = bq_tx.keys() & pg_tx.keys()
print(f"txids: bigquery={len(bq_tx)} postgres={len(pg_tx)} matching={len(common)}")
print("only in bigquery:", sorted(bq_tx.keys() - pg_tx.keys())[:10])
print("only in postgres:", sorted(pg_tx.keys() - bq_tx.keys())[:10])
diffs = {"rank": [], "block_number": [], "block_time": [], "rank_value": [], "parts": []}
for t in sorted(common, key=lambda t: pg_tx[t][0]):
    for i, name in enumerate(["rank", "block_number", "block_time", "rank_value"]):
        if bq_tx[t][i] != pg_tx[t][i]:
            diffs[name].append((t[:16], bq_tx[t][i], pg_tx[t][i]))
    if bq_parts[t] != pg_parts[t]:
        diffs["parts"].append((t[:16], sorted(bq_parts[t] - pg_parts[t])[:3], sorted(pg_parts[t] - bq_parts[t])[:3]))
for k, v in diffs.items():
    print(f"{k} differences: {len(v)}", v[:5])
n_in = sum(1 for t in common for p in pg_parts[t] if p[0] == "in")
n_out = sum(1 for t in common for p in pg_parts[t] if p[0] == "out")
print(f"compared rows on matching txids: inputs={n_in} outputs={n_out}")
