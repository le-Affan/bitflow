"""BigQuery history export adapter, on a trimmed REAL export (tests/data/bigquery_export_sample/, see its README).

The expected stored rows are the fixture's export rows; the BigQuery spike (docs/bigquery-spike.md, section 4) showed
these are identical to what the blockchain.info ingestion stored for 2026-10-09, so both sources store the same data.
"""
import csv
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from app.ingestion.core import ingest_day
from app.ingestion.source import BlockSource, SourceError
from app.sources.bigquery_export import BigQueryExportSource, load_export

DATA = Path(__file__).parent / "data" / "bigquery_export_sample"
DAY = date(2026, 10, 9)
NOW = datetime(2026, 10, 11, tzinfo=timezone.utc)
RANK1 = "f87bfd4c1b6d8d0ee3009f6ef0d2c09f736857edef96b2e0a66761ab172242a7"
RANK10 = "504b198abe3a7a4faeecb64305a2ff4bb85d099166d9a645f060b9a6b8415dfb"


def source() -> BigQueryExportSource:
    return BigQueryExportSource.from_files(DATA / "blocks.csv", DATA / "candidates.csv")


def test_satisfies_block_source_protocol():
    assert isinstance(source(), BlockSource)


def test_blocks_and_headers():
    s = source()
    headers = s.list_block_headers(datetime(2026, 10, 9, tzinfo=timezone.utc), datetime(2026, 10, 10, tzinfo=timezone.utc))
    assert [h.height for h in headers] == list(range(970648, 970655))
    b = s.get_block(970651)
    assert b.time == datetime(2026, 10, 9, 15, 40, 25, tzinfo=timezone.utc)
    assert {t.txid for t in b.transactions} == {RANK1, RANK10}
    assert s.get_block(970650).transactions == ()  # a block without exported candidates


def test_transactions_are_normalized_like_the_chain_model():
    tx = next(t for t in source().get_block(970651).transactions if t.txid == RANK1)
    assert not tx.is_coinbase
    assert [i.position for i in tx.inputs] == sorted(i.position for i in tx.inputs)
    assert all(type(x.value_sat) is int and x.address for x in tx.inputs + tx.outputs)
    assert (tx.outputs[0].address, tx.outputs[0].value_sat) == ("33t9PxtMC3yUpT5gvjVaA4PDwaMT8xCbpu", 6318000000)


def test_unknown_block_is_a_source_error():
    with pytest.raises(SourceError):
        source().get_block(1)


def test_ingest_day_from_export_matches_blockchain_info_stored_rows(repo):
    ingest_day(DAY, source(), repo, margin=0, now=NOW)
    stored = {t.txid: t for t in repo.get_day_transactions(DAY)}
    assert set(stored) == {RANK1, RANK10}
    # Expected rows: the export's rows for these txids (shown identical to the stored blockchain.info rows in the spike).
    expected = {}
    for r in csv.DictReader(open(DATA / "candidates.csv")):
        expected.setdefault(r["txid"], set()).add((r["kind"], int(r["position"]), r["address"], int(r["value_sat"])))
    for txid, tx in stored.items():
        got = {("in", i.position, i.address, i.value_sat) for i in tx.inputs} | {("out", o.position, o.address, o.value_sat) for o in tx.outputs}
        assert got == expected[txid]
        assert tx.block_height == 970651


def test_rejects_wrong_columns(tmp_path):
    bad = tmp_path / "blocks.csv"
    bad.write_text("height,hash,time\n1,x,2\n")
    with pytest.raises(SourceError):
        load_export(bad, DATA / "candidates.csv")


def test_rejects_block_time_mismatch(tmp_path):
    rows = (DATA / "candidates.csv").read_text().splitlines()
    fields = rows[1].split(",")
    fields[4] = str(int(fields[4]) + 1)  # block_time_unix one second off from blocks.csv
    rows[1] = ",".join(fields)
    bad = tmp_path / "candidates.csv"
    bad.write_text("\n".join(rows) + "\n")
    with pytest.raises(SourceError):
        load_export(DATA / "blocks.csv", bad)
