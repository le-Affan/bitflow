# Data source feasibility spike

Date: 2026-10-10. Scripts: `scripts/spikes/` (throwaway).

Goal: find which free public Bitcoin APIs can realistically feed BitFlow (blocks, transactions, input addresses + values, output addresses + values), based on real calls.

This document reports findings only. It does not recommend a provider.

## Labels

- **measured**: observed in real requests made during this spike.
- **from docs**: stated in the provider's official docs or blog.
- **third-party**: stated only by non-official sources. Not verified.
- **extrapolation**: computed from measured numbers. Not observed directly.
- **unverified**: could not be checked.

## Test setup

- Test day: **2026-10-08 UTC** = block heights **970410–970548** = **139 blocks**, **630,220 transactions** (measured, from both mempool.space and Blockstream block lists, and confirmed by blockchain.info, all three agree).
- Full year figures assume 365 × 139 blocks ≈ 50,700 blocks and 365 × 630,220 ≈ 230M transactions (extrapolation from this one day; real days vary).
- All requests sequential, one API at a time per host, with a pause between requests (0.25 s for mempool/Esplora, 1 s for blockchain.info).
- Machine-specific issue (measured): Python `urllib` stalled on connect to some mempool.space IPs while curl did not, so the helper shells out to `curl -4`. This does not affect the API results.

## Summary table

| API | Rate limit | Key needed | Requests per block (complete inputs + outputs) | Requests per day | Can backfill 1 year within limits? | Notes |
|---|---|---|---|---|---|---|
| **blockchain.info** (Blockchain.com Data API) | Not published for `/block-height`, `/rawblock` (unverified). Third-party directory says "throttled per IP". No rate-limit headers returned (measured). 0 throttling in 139 sequential requests (measured). | No (measured) | **1** (measured): one response contains every tx with input `prev_out.addr` + `prev_out.value` and output `addr` + `value` | **139** (measured, plus 1 optional `/blocks/{ms}` call to list the day's blocks) | **Unknown.** Request count is small (~50,700, extrapolation), but limits are unpublished and the volume is large: ~1.1 GB/day measured → ~400 GB/year (extrapolation), ~108 h sequential at measured pace incl. 1 s pauses (extrapolation). | Largest payloads by far (avg ~7.9 MB/block, measured). 1 request per block regardless of tx count. |
| **mempool.space** (public instance) | Undisclosed. Docs: "we enforce rate limits… HTTP 429" (from docs). Maintainers say limits are intentionally not disclosed (third-party: GitHub discussion). No rate-limit headers (measured). 0 throttling in 624 requests (measured). | No (measured) | **1 + ceil(tx_count / 25)** (measured). Sample blocks: 154, 191, 265 requests (measured) | **~25,425** (extrapolation from measured per-block formula + measured tx counts) | **No (practically).** ~9.3M requests/year (extrapolation); at measured pace (~1.47 s/request) ≈ 10.4 h per day of data → ~158 days to backfill a year sequentially (extrapolation). Undisclosed limits make this risky. | Inputs include full `prevout` (address + value) inline, 0 missing in 15,155 sampled txs (measured). `blocks-bulk` endpoint is disabled on public instance (measured: 404 "This API is disabled"). Has block-by-timestamp lookup (from docs + measured). |
| **Blockstream Esplora** (blockstream.info/api) | Free tier is rate limited, numbers not published (from docs: Blockstream blog, Apr 2026). Third-party: ~500k requests/month free tier, ~50 req/s nginx limit (unverified). No rate-limit headers (measured). 0 throttling in 624 requests (measured). | Not for blockstream.info/api today (measured). Blog says keys/accounts for the managed Explorer API (from docs); whether the public endpoint will require one is unverified. | **1 + ceil(tx_count / 25)** (measured, same Esplora API as mempool.space). Samples: 154, 191, 265 requests (measured) | **~25,425** (extrapolation) | **No.** ~9.3M requests/year (extrapolation). If the third-party 500k/month figure is right, that covers ~20 days of data per month, and even daily ingestion alone (~763k/month) would exceed it (extrapolation). At measured pace (~1.22 s/request) ≈ 8.6 h per day of data → ~131 days for a year (extrapolation). | Same response shape as mempool.space. 0 missing prevouts in sampled txs (measured). No timestamp lookup endpoint (from docs). |
| **BlockCypher** | Free: 3 req/s, 100 req/h, 1,000 req/day (from docs: dev docs + pricing page) | No for free tier, token optional (from docs). `x-ratelimit-remaining` header returned (measured). | Block endpoint returns only txids, max 500 per request (measured / from docs). Tx inputs (`addresses`, `output_value`) need one tx call each (measured) → **~ceil(tx_count / 500) + tx_count** | **~631,600** (extrapolation: ~1,330 txid-page calls across 139 blocks + 630,220 tx calls) | **No.** Even one day needs ~630× the daily quota (extrapolation). | Batching up to 100 elements per call exists (from docs), but docs say larger batches need a paid token, and it is unverified whether a batch counts as 1 or N requests toward the limit. |
| **Blockchair** | **Unverified.** Docs page returned HTTP 401 to automated fetch. API returned **HTTP 430 "Your IP address is temporary blacklisted due to exceeding usage of API resources. Please apply for an API key"** on the 2nd request and again ~45 min later (measured). | Effectively yes from this IP (measured: 430 asks for a key) | Unverified | Unverified | Unverified | Only 1 successful call (`/bitcoin/stats`). Cause of blacklist unknown (only 1 prior request from this spike; IP may be shared or previously flagged). Response notes "Try out our new API v.3: https://3xpl.com/data" (measured). |

## Measured numbers (2026-10-08, 139 blocks, 630,220 txs)

### blockchain.info: full day ingested

- Requests: **139**, all HTTP 200, 0 retries.
- Wall time: **1,063 s (17.7 min)** including a 1 s pause per request. Per block: min 1.5 s, median 6.2 s, max 15.5 s, mean 6.6 s.
- Downloaded: **1,095,978,366 bytes (~1.1 GB)**.
- Completeness: 630,220 txs, 1,125,221 inputs, 1,474,013 outputs. Every input has a `prev_out` object. 140 inputs have no address (139 are the coinbase inputs, 1 other). **358,051 outputs (24%) have no address** (OP_RETURN and other non-standard scripts).
- No rate-limit headers in responses (measured).

### mempool.space: 3 full sample blocks + day block list

- Day block list: 14 requests (15 blocks per call), 17.7 s.
- Sample blocks, all pages fetched:

| Height | tx_count | Requests | Time |
|---|---|---|---|
| 970410 | 3,822 | 154 | 238.9 s |
| 970480 | 4,749 | 191 | 284.9 s |
| 970548 | 6,584 | 265 | 375.1 s |

- Total: **624 requests**, all HTTP 200, 0 retries, ~30 MB.
- 0 inputs missing `prevout` in 15,155 sampled txs.
- Extrapolation for full day: **25,425 requests**, ~37,500 s (~10.4 h) at measured pace.
- Single raw block (`/block/:hash/raw`, 970500): 1 request, 1.6 MB, 5.8 s (measured). Raw block bytes contain outputs but **not** the spent input addresses/values, so inputs would still need extra calls (not measured).

### Blockstream Esplora: same 3 sample blocks + day block list

- Day block list: 14 requests (10 blocks per call), 14.8 s.
- Sample blocks: 154 / 191 / 265 requests, 207.5 s / 231.1 s / 305.5 s, all HTTP 200.
- Total: **624 requests**, all HTTP 200, 0 retries, ~30 MB.
- 0 inputs missing `prevout` in sampled txs.
- Extrapolation for full day: **25,425 requests**, ~31,000 s (~8.6 h) at measured pace.

### BlockCypher

- 2 requests made (sample block with `limit=500`, one tx). `txids` returned: 500 of 4,405 (measured). Tx inputs carry `addresses` and `output_value` (measured). `x-ratelimit-remaining: 1` seen on an earlier probe (measured; meaning not documented on the page fetched).
- Full-day ingestion not attempted: the free quota (1,000/day, from docs) is below one block's tx count (4,405, measured).

### Blockchair

- 1 successful request, then HTTP 430 on every further attempt (6 requests total, including retries by the helper) (measured).

## Response shapes (sample block 970500)

Trimmed samples. Full trimmed JSON was saved locally during the spike, not committed.

**mempool.space / Esplora** (identical shape), `GET /block/:hash`:

```json
{"id": "000…f363", "height": 970500, "version": 536903680, "timestamp": 1791470870,
 "tx_count": 4405, "size": 1613636, "weight": 3997937, "merkle_root": "…",
 "previousblockhash": "…", "mediantime": 1791465651, "nonce": 2451002424,
 "bits": 386014960, "difficulty": 132716002350731.27}
```

`GET /block/:hash/txs/:start_index` (25 txs per page), one tx:

```json
{"txid": "…", "version": 1, "locktime": 0, "size": 535, "weight": 2032, "fee": 9900,
 "vin": [{"txid": "…", "vout": 0, "is_coinbase": false, "sequence": 1,
          "prevout": {"scriptpubkey": "…", "scriptpubkey_type": "p2sh",
                      "scriptpubkey_address": "35Sh…", "value": 4313119}}],
 "vout": [{"scriptpubkey": "…", "scriptpubkey_type": "p2sh",
           "scriptpubkey_address": "3EUD…", "value": 4303219}],
 "status": {"confirmed": true, "block_height": 970500, "block_hash": "…", "block_time": 1791470870}}
```

Values are in satoshis. Outputs without an address omit `scriptpubkey_address`. Coinbase input has `"prevout": null`.

**blockchain.info**, `GET /block-height/970500?format=json` → `{"blocks": [ … ]}`:

```json
{"hash": "…", "height": 970500, "time": 1791470870, "n_tx": 4405, "size": 1613636,
 "weight": 3997937, "fee": 3957177, "prev_block": "…", "next_block": ["…"], "main_chain": true,
 "tx": [{"hash": "…", "time": 1791470870, "block_height": 970500, "fee": 0, "vin_sz": 1, "vout_sz": 8,
         "inputs": [{"prev_out": {"addr": "…", "value": 4313119, "n": 0, "tx_index": …, "script": "…"}, "index": 0}],
         "out": [{"addr": "1K6K…", "value": 546, "n": 0, "spent": false, "script": "…"}]}]}
```

All txs of the block are in one response. Values in satoshis. Coinbase input has a `prev_out` with `value: 0` and no `addr`.

**BlockCypher**, `GET /v1/btc/main/blocks/970500?limit=500`: block header fields plus `txids` (max 500) and `next_txids` URL. `GET /v1/btc/main/txs/:hash`:

```json
{"hash": "…", "block_height": 970500, "confirmed": "2026-10-08T14:47:50Z", "total": 4303219,
 "inputs": [{"prev_hash": "…", "output_index": 0, "output_value": 4313119, "addresses": ["35Sh…"], "script_type": "pay-to-script-hash"}],
 "outputs": [{"value": 4303219, "addresses": ["3EUD…"], "script_type": "pay-to-script-hash"}]}
```

**Blockchair**: not captured (HTTP 430).

## Date/time range queries

| API | Finding |
|---|---|
| mempool.space | `GET /api/v1/mining/blocks/timestamp/:ts` returns the block closest to a timestamp (from docs + measured; returned the last block **before** midnight). Then list blocks by height. |
| Esplora | No timestamp lookup (from docs). Must walk blocks by height. |
| blockchain.info | `GET /blocks/{ms}?format=json` returns a day's block list in 1 request (measured). Quirk: passing 2026-10-09T00:00Z returned the blocks of **2026-10-08** (139 blocks, 970410–970548), so the timestamp appears to mark the end of the day returned (measured, not documented). |
| BlockCypher | No range-by-date endpoint found in docs (unverified beyond the parts of the docs read). |
| Blockchair | Unverified (blocked). |

## "Largest transactions by output value" without scanning every tx

| API | Finding |
|---|---|
| mempool.space | No such endpoint (from docs). `GET /api/v1/block/:hash/summary` returns every tx in a block in 1 request with `value` = **total** output value, plus fee/vsize, but **no addresses and not the largest single output** (measured). Does not directly answer the PRD's ranking (largest individual output). |
| Esplora | No (from docs). |
| blockchain.info | No such endpoint found (unverified: no official docs page listing endpoints could be fetched). Not needed for request count since the full block is 1 request, but still a full scan locally. |
| BlockCypher | No (from docs read). |
| Blockchair | Its `outputs` table is described as filterable by time and sortable by value, which would answer this directly. **Unverified**: test query `GET /bitcoin/outputs?q=time(2026-10-08)&s=value(desc)&limit=100` returned HTTP 430. |
| Google BigQuery `bigquery-public-data.crypto_bitcoin` (not tested) | SQL over full inputs/outputs could answer this directly. **Unverified**: no Google Cloud credentials on this machine; current freshness of the dataset in 2026 is unconfirmed; free tier quota not checked. Not tested. |

## Could not verify

- Actual rate limits for mempool.space, Blockstream (public endpoint and free tier), and blockchain.info. None return rate-limit headers, none throttled within the small samples, and none publish numbers.
- Whether the public blockstream.info/api will require a key under the 2026 free-tier changes.
- Anything about Blockchair beyond the 430 response: limits, request costs, response shapes, the outputs-sort query.
- BlockCypher batching cost (1 vs N requests per batch) and the meaning of `x-ratelimit-remaining: 1`.
- Whether blockchain.info would throttle a sustained multi-day backfill (~400 GB).
- BigQuery and any key-based providers (e.g. Bitquery): not tested.
- All per-year figures: one-day extrapolations only.
