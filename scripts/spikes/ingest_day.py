"""Measure the request cost of ingesting blocks with complete inputs and outputs. Throwaway.

Usage:
  python ingest_day.py blockchaininfo FIRST_HEIGHT LAST_HEIGHT
  python ingest_day.py mempool|esplora FIRST_HEIGHT LAST_HEIGHT [SAMPLE_HEIGHT ...]

blockchaininfo: fetches every block in the range (1 request per block).
mempool/esplora: fetches the tx_count of every block in the range (cheap block-list calls),
then fully pages through only the SAMPLE_HEIGHTs (25 txs per page) and checks completeness.
Requests are strictly sequential with a pause between them to stay polite.
"""
import json
import sys
import time

from spike_http import Counter

BASES = {"mempool": "https://mempool.space/api", "esplora": "https://blockstream.info/api"}
PAUSE = float({"blockchaininfo": 1.0}.get(sys.argv[1], 0.25))


def check_esplora_tx(tx, stats):
    stats["txs"] += 1
    for vin in tx["vin"]:
        stats["inputs"] += 1
        if vin.get("is_coinbase"):
            stats["coinbase_inputs"] += 1
        elif vin.get("prevout") is None:
            stats["inputs_missing_prevout"] += 1
        elif "scriptpubkey_address" not in vin["prevout"]:
            stats["inputs_without_address"] += 1
    for vout in tx["vout"]:
        stats["outputs"] += 1
        if "scriptpubkey_address" not in vout:
            stats["outputs_without_address"] += 1


def check_bci_tx(tx, stats):
    stats["txs"] += 1
    for vin in tx["inputs"]:
        stats["inputs"] += 1
        prev = vin.get("prev_out")
        if not prev:
            stats["coinbase_or_missing_prevout"] += 1
        elif not prev.get("addr"):
            stats["inputs_without_address"] += 1
    for out in tx["out"]:
        stats["outputs"] += 1
        if not out.get("addr"):
            stats["outputs_without_address"] += 1


def new_stats():
    return {k: 0 for k in ("txs", "inputs", "outputs", "coinbase_inputs", "inputs_missing_prevout",
                           "inputs_without_address", "outputs_without_address", "coinbase_or_missing_prevout")}


def run_blockchaininfo(first, last):
    c = Counter("blockchain.info")
    stats = new_stats()
    per_block = []
    t0 = time.time()
    for h in range(first, last + 1):
        t = time.time()
        blk = c.get(f"https://blockchain.info/block-height/{h}?format=json")["blocks"][0]
        for tx in blk["tx"]:
            check_bci_tx(tx, stats)
        per_block.append({"height": h, "n_tx": blk["n_tx"], "secs": round(time.time() - t, 2)})
        print(f"{h} n_tx={blk['n_tx']} {per_block[-1]['secs']}s total_req={c.requests}", flush=True)
        time.sleep(PAUSE)
    return {"summary": c.summary(), "elapsed_s": round(time.time() - t0, 1), "blocks": len(per_block),
            "tx_total": sum(b["n_tx"] for b in per_block), "stats": stats, "last_limit_headers": c.last_headers}


def run_esplora(name, first, last, samples):
    base = BASES[name]
    c = Counter(name)
    # /blocks/:start_height returns 10 (esplora) or 15 (mempool) blocks descending, incl. tx_count.
    counts = {}
    t0 = time.time()
    h = last
    while h >= first:
        for b in c.get(f"{base}/blocks/{h}"):
            counts[b["height"]] = b["tx_count"]
        h = min(counts) - 1
        time.sleep(PAUSE)
    counts = {k: v for k, v in counts.items() if first <= k <= last}
    list_requests = c.requests
    list_secs = time.time() - t0

    sample_results = []
    for sh in samples:
        before = c.requests
        stats = new_stats()
        t = time.time()
        bh = c.get(f"{base}/block-height/{sh}", raw=True).decode()
        start = 0
        while True:
            page = c.get(f"{base}/block/{bh}/txs/{start}")
            for tx in page:
                check_esplora_tx(tx, stats)
            start += 25
            time.sleep(PAUSE)
            if len(page) < 25:
                break
        sample_results.append({"height": sh, "tx_count": counts.get(sh), "requests": c.requests - before,
                               "secs": round(time.time() - t, 1), "stats": stats})
        print(json.dumps(sample_results[-1]), flush=True)

    total_txs = sum(counts.values())
    # 1 block-hash lookup + ceil(tx_count / 25) pages per block.
    pages_day = sum(1 + -(-n // 25) for n in counts.values())
    sample_req = sum(s["requests"] for s in sample_results)
    sample_secs = sum(s["secs"] for s in sample_results)
    return {"summary": c.summary(), "blocks_in_range": len(counts), "tx_total_in_range": total_txs,
            "block_list_requests": list_requests, "block_list_secs": round(list_secs, 1),
            "samples": sample_results,
            "extrapolated_requests_full_day": pages_day + list_requests,
            "extrapolated_secs_full_day_at_measured_pace": round(sample_secs / sample_req * (pages_day + list_requests)),
            "last_limit_headers": c.last_headers}


if __name__ == "__main__":
    api, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    if api == "blockchaininfo":
        result = run_blockchaininfo(first, last)
    else:
        result = run_esplora(api, first, last, [int(x) for x in sys.argv[4:]])
    print("RESULT " + json.dumps(result))
