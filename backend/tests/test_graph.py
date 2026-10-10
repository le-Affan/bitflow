# All data in this module is synthetic (tests/api_fixtures.py). Pure functions: no database involved.

from app.domain.graph import address_summary, build_graph, edge_transactions, transaction_pairs
from tests.api_fixtures import fixture_day, ftx, ftxid


def edges(graph):
    return {(e.source, e.target): e.tx_count for e in graph.edges}


def test_many_inputs_to_many_outputs():
    g = build_graph([ftx(1, [("A", 1), ("B", 1), ("C", 1)], [("X", 1), ("Y", 1)])])
    assert edges(g) == {(s, t): 1 for s in "ABC" for t in "XY"}
    assert g.nodes == ("A", "B", "C", "X", "Y")


def test_self_loop_pair_dropped_other_pairs_kept():
    g = build_graph([ftx(1, [("A", 5), ("B", 5)], [("A", 4), ("C", 4)])])
    assert edges(g) == {("A", "C"): 1, ("B", "A"): 1, ("B", "C"): 1}


def test_repeated_pair_aggregated_across_transactions():
    g = build_graph([ftx(1, [("A", 5)], [("B", 4)]), ftx(2, [("A", 9)], [("B", 8)]), ftx(3, [("B", 1)], [("A", 1)])])
    assert edges(g) == {("A", "B"): 2, ("B", "A"): 1}
    assert next(e for e in g.edges if e.source == "A").txids == (ftxid(1), ftxid(2))


def test_duplicate_address_within_one_tx_counts_once():
    assert transaction_pairs(ftx(1, [("A", 1), ("A", 2)], [("B", 1), ("B", 2)])) == {("A", "B")}


def test_nodes_only_from_edges():
    g = build_graph(fixture_day())
    assert "fx-E" not in g.nodes  # only appears in a self-loop
    assert g.nodes == ("fx-A", "fx-B", "fx-C", "fx-D")


def test_fixture_day_edges():
    assert edges(build_graph(fixture_day())) == {
        ("fx-A", "fx-C"): 3, ("fx-A", "fx-D"): 1, ("fx-B", "fx-C"): 1, ("fx-B", "fx-D"): 1}


def test_empty_input_gives_empty_graph():
    g = build_graph([])
    assert g.nodes == () and g.edges == ()


def test_address_summary_sums_inputs_and_outputs():
    s = address_summary(fixture_day(), "fx-A")
    assert (s.transaction_count, s.spent_sat, s.received_sat) == (3, 500 + 1_000 + 90, 700)
    c = address_summary(fixture_day(), "fx-C")
    assert (c.transaction_count, c.spent_sat, c.received_sat) == (3, 0, 600 + 250 + 70)


def test_address_summary_none_for_non_node():
    assert address_summary(fixture_day(), "fx-E") is None
    assert address_summary(fixture_day(), "nope") is None


def test_edge_transactions_amount_to_target_and_order():
    rows = edge_transactions(fixture_day(), "fx-A", "fx-C")
    assert [(r.txid, r.amount_to_target_sat) for r in rows] == [(ftxid(3), 70), (ftxid(1), 600), (ftxid(2), 250)]


def test_edge_transactions_empty_for_self_loop_or_missing():
    assert edge_transactions(fixture_day(), "fx-E", "fx-E") == []
    assert edge_transactions(fixture_day(), "fx-C", "fx-A") == []
