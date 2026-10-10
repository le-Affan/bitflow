"""Independent check of stored transactions against mempool.space (Esplora API). Throwaway, uses curl.

Usage: python verify_against_mempool.py STORED_JSON
STORED_JSON: [{"txid", "block_height", "block_time_unix", "max_addressed_output_sat"}] exported from the DB.
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


stored = json.load(open(sys.argv[1]))
for s in stored:
    tx = get(f"https://mempool.space/api/tx/{s['txid']}")
    addressed = [o for o in tx["vout"] if o.get("scriptpubkey_address")]
    in_addrs = {v["prevout"]["scriptpubkey_address"] for v in tx["vin"] if v.get("prevout") and v["prevout"].get("scriptpubkey_address")}
    top = max(addressed, key=lambda o: o["value"])
    res = {
        "txid": s["txid"][:16],
        "max_addressed_output_db": s["max_addressed_output_sat"],
        "max_addressed_output_mempool": top["value"],
        "height_db": s["block_height"], "height_mempool": tx["status"]["block_height"],
        "time_db": s["block_time_unix"], "time_mempool": tx["status"]["block_time"],
        "largest_output_goes_to_input_address": top["scriptpubkey_address"] in in_addrs,
        "coinbase": any(v.get("is_coinbase") for v in tx["vin"]),
    }
    res["match"] = (res["max_addressed_output_db"] == res["max_addressed_output_mempool"]
                    and res["height_db"] == res["height_mempool"] and res["time_db"] == res["time_mempool"])
    print(json.dumps(res))
