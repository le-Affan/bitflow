"""Independent estimate of how many txs have no edge after dropping self-loops, from mempool.space. Throwaway.

Usage: python sample_edge_rate.py HEIGHT START_INDEX [START_INDEX ...]   (25 txs per page from each start index, multiple of 25)
"""
import json
import subprocess
import sys
import time


def get(url, raw=False):
    out = subprocess.run(["curl", "-4", "-sS", "-m", "60", "-A", "BitFlow-check/0.1", url],
                         capture_output=True, check=True).stdout
    time.sleep(1)
    return out.decode() if raw else json.loads(out)


height, starts = int(sys.argv[1]), [int(x) for x in sys.argv[2:]]
h = get(f"https://mempool.space/api/block-height/{height}", raw=True).strip()
counts = {"txs": 0, "coinbase": 0, "no_addressed_in_or_out": 0, "no_edge": 0, "eligible": 0, "requests": 1}
for start in starts:
    txs = get(f"https://mempool.space/api/block/{h}/txs/{start}")
    counts["requests"] += 1
    for tx in txs:
        counts["txs"] += 1
        if any(v.get("is_coinbase") for v in tx["vin"]):
            counts["coinbase"] += 1
            continue
        ins = {v["prevout"].get("scriptpubkey_address") for v in tx["vin"]} - {None}
        outs = {o.get("scriptpubkey_address") for o in tx["vout"]} - {None}
        if not ins or not outs:
            counts["no_addressed_in_or_out"] += 1
        elif not any(a != b for a in ins for b in outs):
            counts["no_edge"] += 1
        else:
            counts["eligible"] += 1
print(json.dumps({"height": height, **counts}))
