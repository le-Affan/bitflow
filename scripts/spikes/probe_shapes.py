"""Fetch one sample block from each API and save trimmed response shapes. Throwaway."""
import json
import sys
from pathlib import Path

from spike_http import Counter

HEIGHT = int(sys.argv[1]) if len(sys.argv) > 1 else 970500
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "out")
OUT.mkdir(exist_ok=True)


def trim(o, depth=0):
    """Keep structure, cut long lists to 1 element."""
    if isinstance(o, list):
        return [trim(x, depth + 1) for x in o[:1]] + ([f"... {len(o)} items"] if len(o) > 1 else [])
    if isinstance(o, dict):
        return {k: trim(v, depth + 1) for k, v in o.items()}
    return o


def save(name, obj):
    (OUT / f"{name}.json").write_text(json.dumps(trim(obj), indent=1))


for base, name in (("https://mempool.space/api", "mempool"), ("https://blockstream.info/api", "esplora")):
    c = Counter(name)
    h = c.get(f"{base}/block-height/{HEIGHT}", raw=True).decode()
    blk = c.get(f"{base}/block/{h}")
    txs = c.get(f"{base}/block/{h}/txs/0")
    txids = c.get(f"{base}/block/{h}/txids")
    save(f"{name}_block", blk)
    save(f"{name}_block_txs_page", txs)
    print(name, "tx_count", blk["tx_count"], "page_len", len(txs), "txids_len", len(txids),
          "vin[0] of tx1 has prevout:", "prevout" in txs[1]["vin"][0], txs[1]["vin"][0]["prevout"].keys(),
          c.summary(), c.last_headers)

c = Counter("blockchain.info")
blk = c.get(f"https://blockchain.info/block-height/{HEIGHT}?format=json")
b = blk["blocks"][0]
save("blockchaininfo_block", blk)
print("blockchain.info n_tx", b["n_tx"], "txs in response", len(b["tx"]),
      "input prev_out keys", b["tx"][1]["inputs"][0]["prev_out"].keys(), c.summary(), c.last_headers)

c = Counter("blockcypher")
blk = c.get(f"https://api.blockcypher.com/v1/btc/main/blocks/{HEIGHT}?limit=500")
save("blockcypher_block", blk)
tx = c.get(f"https://api.blockcypher.com/v1/btc/main/txs/{blk['txids'][1]}?limit=50")
save("blockcypher_tx", tx)
print("blockcypher n_tx", blk["n_tx"], "txids returned", len(blk["txids"]), "input keys", tx["inputs"][0].keys(),
      c.summary(), c.last_headers)

c = Counter("blockchair")
blk = c.get(f"https://api.blockchair.com/bitcoin/dashboards/block/{HEIGHT}")
save("blockchair_block_dashboard", blk)
print("blockchair dashboard txids", len(blk["data"][str(HEIGHT)]["transactions"]), "context", blk["context"])
