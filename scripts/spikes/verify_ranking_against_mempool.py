"""Independent check of the "outward output" ranking against mempool.space (Esplora API). Throwaway, uses curl.

Usage: python verify_ranking_against_mempool.py STORED_JSON
STORED_JSON: [{"rank", "txid", "block_height", "block_time_unix", "rank_address", "rank_value_sat"}] from the DB.
"""
import json
import subprocess
import sys
import time


def get(url):
    out = subprocess.run(["curl", "-4", "-sS", "-m", "60", "-A", "BitFlow-check/0.1", url],
                         capture_output=True, check=True).stdout
    time.sleep(1)
    return json.loads(out)


for s in json.load(open(sys.argv[1])):
    tx = get(f"https://mempool.space/api/tx/{s['txid']}")
    inputs = {v["prevout"]["scriptpubkey_address"] for v in tx["vin"]
              if v.get("prevout") and v["prevout"].get("scriptpubkey_address")}
    outward = [o for o in tx["vout"] if o.get("scriptpubkey_address") and o["scriptpubkey_address"] not in inputs]
    best = max(outward, key=lambda o: o["value"])
    res = {
        "rank": s["rank"], "txid": s["txid"][:16],
        "db_address": s["rank_address"][:14], "mempool_address": best["scriptpubkey_address"][:14],
        "db_value": s["rank_value_sat"], "mempool_value": best["value"],
        "address_is_input_on_mempool": best["scriptpubkey_address"] in inputs,
        "height_ok": s["block_height"] == tx["status"]["block_height"],
        "time_ok": s["block_time_unix"] == tx["status"]["block_time"],
        "coinbase": any(v.get("is_coinbase") for v in tx["vin"]),
    }
    res["match"] = (best["scriptpubkey_address"] == s["rank_address"] and best["value"] == s["rank_value_sat"]
                    and res["height_ok"] and res["time_ok"] and not res["address_is_input_on_mempool"])
    print(json.dumps(res))
