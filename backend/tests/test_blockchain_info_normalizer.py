"""Normalizer tests on a real, trimmed blockchain.info response.

Fixture origin: tests/data/blockchain_info_block_970500_trimmed.json is a real response of
GET https://blockchain.info/block-height/970500?format=json (the data-source spike's sample block), fetched
2026-10-11 and trimmed to 4 of its 4405 transactions. See its "_origin" field.
"""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.ingestion.core import has_edge, ranking_value
from app.ingestion.source import SourceError
from app.sources.blockchain_info.normalizer import normalize_block, normalize_headers

FIXTURE = json.loads((Path(__file__).parent / "data" / "blockchain_info_block_970500_trimmed.json").read_text())


def _payload(n_tx_matches=True):
    p = copy.deepcopy(FIXTURE)
    if n_tx_matches:
        p["blocks"][0]["n_tx"] = len(p["blocks"][0]["tx"])  # trimmed fixture: make the count consistent
    return p


def test_block_header_fields():
    b = normalize_block(_payload(), 970500)
    assert b.height == 970500
    assert b.hash == "00000000000000000001190ed1dcc169460315b60f7271ffc8d85dd41b63f363"
    assert b.time == datetime(2026, 10, 8, 14, 47, 50, tzinfo=timezone.utc)
    assert len(b.transactions) == 4


def test_coinbase_detected_and_has_no_input_address():
    cb = normalize_block(_payload(), 970500).transactions[0]
    assert cb.txid == "b30cb61387a1fb94ba678830c10e88789c149d97b75740c342013506561761da"
    assert cb.is_coinbase
    assert [i.address for i in cb.inputs] == [None]
    assert [o.address for o in cb.outputs][:2] == ["1K6KoYC69NnafWJ7YgtrpwJxBLiijWqwa6", "1AfCc4F9c4VTYSE31PUe2kUEKs6ZxiDjxm"]
    assert [o.address for o in cb.outputs][2:] == [None] * 6  # OP_RETURN-style outputs


def test_multi_input_tx_with_no_address_output():
    tx = normalize_block(_payload(), 970500).transactions[1]
    assert tx.txid == "4abf61d6c1fc539aeba471ee419e989b2a9066066efa4df37633eabe5a318f00"
    assert not tx.is_coinbase
    assert [(i.position, i.value_sat) for i in tx.inputs] == [(0, 116070), (1, 115800), (2, 330)]
    assert [(o.position, o.address is None, o.value_sat) for o in tx.outputs] == [
        (0, False, 113000), (1, False, 2590), (2, True, 0), (3, False, 113191)]
    # Largest addressed output goes back to an input address (change); it still sets the ranking value.
    assert ranking_value(tx) == 113191
    assert has_edge(tx)


def test_change_back_to_input_address_keeps_other_edge():
    tx = normalize_block(_payload(), 970500).transactions[2]
    assert tx.inputs[0].address == tx.outputs[1].address == "bc1qan4zp4ek0mjn258xe29v8f8w7nq00jf2nu9dqz"
    assert has_edge(tx)
    assert ranking_value(tx) == 35220076


def test_all_values_are_integer_satoshis():
    b = normalize_block(_payload(), 970500)
    assert all(type(x.value_sat) is int for t in b.transactions for x in t.inputs + t.outputs)


def test_wrong_height_rejected():
    with pytest.raises(SourceError):
        normalize_block(_payload(), 970501)


def test_n_tx_mismatch_rejected():
    with pytest.raises(SourceError):
        normalize_block(_payload(n_tx_matches=False), 970500)  # fixture is trimmed: n_tx 4405 vs 4 txs


def test_non_main_chain_block_ignored():
    p = _payload()
    orphan = copy.deepcopy(p["blocks"][0]) | {"main_chain": False, "hash": "f" * 64}
    p["blocks"].insert(0, orphan)
    assert normalize_block(p, 970500).hash == FIXTURE["blocks"][0]["hash"]


def test_float_value_rejected():
    p = _payload()
    p["blocks"][0]["tx"][3]["out"][0]["value"] = 0.5
    with pytest.raises(SourceError):
        normalize_block(p, 970500)


def test_headers_from_listing():
    # Synthetic listing entries (TEST DATA), same keys as the real /blocks/{ms} response.
    headers = normalize_headers([{"height": 1, "hash": "x", "time": 1791504000}])
    assert headers[0].height == 1 and headers[0].time == datetime(2026, 10, 9, tzinfo=timezone.utc)
