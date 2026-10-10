"""Throwaway: count a UTC day's transactions/outputs/inputs on blockchain.info, for comparison with BigQuery.

Usage: python bci_day_counts.py DAY MIN_HEIGHT MAX_HEIGHT [MARGIN]
Fetches heights MIN-MARGIN..MAX+MARGIN sequentially (1 s pause, curl via ../spike_http.py), extends while a block
inside the day sits in the outer margin, and counts only blocks whose own timestamp is inside the UTC day.
blockchain.info exposes at most one address per output ("addr"), so 2+ address outputs show up as "no address".
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spike_http import Counter  # noqa: E402

day, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
margin = int(sys.argv[4]) if len(sys.argv) > 4 else 3
start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
end = start + timedelta(days=1)
c = Counter("blockchain.info")
inside, stats = {}, dict(blocks=0, heights=[], excluded=[], transactions=0, outputs=0, outputs_without_address=0,
                         inputs=0, inputs_without_address=0, coinbase_inputs=0)
t0 = time.time()


def fetch(h):
    b = [x for x in c.get(f"https://blockchain.info/block-height/{h}?format=json")["blocks"] if x.get("main_chain")][0]
    ts = datetime.fromtimestamp(b["time"], timezone.utc)
    inside[h] = start <= ts < end
    if not inside[h]:
        stats["excluded"].append(h)
    else:
        stats["blocks"] += 1
        stats["heights"].append(h)
        for tx in b["tx"]:
            stats["transactions"] += 1
            for i in tx["inputs"]:
                stats["inputs"] += 1
                p = i.get("prev_out")
                if p is None or p.get("n") == 0xFFFFFFFF:
                    stats["coinbase_inputs"] += 1
                if not (p and p.get("addr")):
                    stats["inputs_without_address"] += 1
            for o in tx["out"]:
                stats["outputs"] += 1
                if not o.get("addr"):
                    stats["outputs_without_address"] += 1
    print(f"{day} {h} in_day={inside[h]} requests={c.requests} elapsed={time.time() - t0:.0f}s", file=sys.stderr, flush=True)
    time.sleep(1)


for h in range(lo - margin, hi + margin + 1):
    fetch(h)
low, high = lo - margin, hi + margin
while any(inside[h] for h in range(low, low + margin)):
    low -= 1
    fetch(low)
while any(inside[h] for h in range(high - margin + 1, high + 1)):
    high += 1
    fetch(high)
stats["heights"] = f"{min(stats['heights'])}-{max(stats['heights'])}"
print(json.dumps({"day": day, **stats, "source": c.summary(), "elapsed_s": round(time.time() - t0)}))
