"""Verify stored days against mempool.space: ranks 1, 2, 3 and 100, recomputed from the stored rows with the ranking
rule in plain SQL (read-only), then checked with scripts/spikes/verify_ranking_against_mempool.py.

Usage: python3 scripts/bigquery_history/verify_days.py DAY [DAY ...]   (run from the repository root)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SQL = """
WITH rank_out AS (
  SELECT DISTINCT ON (t.txid) t.txid, t.block_height, extract(epoch FROM t.block_time)::bigint AS block_time_unix,
         o.address AS rank_address, o.value_sat AS rank_value_sat
  FROM transactions t JOIN tx_outputs o ON o.day = t.day AND o.txid = t.txid
  WHERE t.day = '{day}'
    AND NOT EXISTS (SELECT 1 FROM tx_inputs i WHERE i.day = t.day AND i.txid = t.txid AND i.address = o.address)
  ORDER BY t.txid, o.value_sat DESC, o.position
), ranked AS (SELECT row_number() OVER (ORDER BY rank_value_sat DESC, txid) AS rank, * FROM rank_out)
SELECT coalesce(json_agg(json_build_object('day', '{day}', 'rank', rank, 'txid', txid, 'block_height', block_height,
  'block_time_unix', block_time_unix, 'rank_address', rank_address, 'rank_value_sat', rank_value_sat) ORDER BY rank), '[]')
FROM ranked WHERE rank IN (1, 2, 3, 100);
"""
rows = []
for day in sys.argv[1:]:
    p = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'],
                       input=SQL.format(day=day), capture_output=True, text=True, cwd=ROOT, check=True)
    if not p.stdout.strip():
        sys.exit(f"no output from psql for {day}: stderr={p.stderr.strip()[:300]!r}")
    rows += json.loads(p.stdout.strip())
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(rows, f)
out = subprocess.run([sys.executable, str(ROOT / "scripts/spikes/verify_ranking_against_mempool.py"), f.name],
                     capture_output=True, text=True, check=True).stdout.splitlines()
ok = True
for r, line in zip(rows, out):
    res = json.loads(line)
    ok &= res["match"]
    print(f"{r['day']} rank {r['rank']:>3} {r['txid'][:16]} value {r['rank_value_sat']} {'match' if res['match'] else 'MISMATCH ' + line}")
print("ALL MATCH" if ok and len(rows) == 4 * len(sys.argv[1:]) else f"NOT ALL MATCH ({len(rows)} rows checked)")
sys.exit(0 if ok and len(rows) == 4 * len(sys.argv[1:]) else 1)
