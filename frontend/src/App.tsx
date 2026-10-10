import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, isEmptyState } from "./api/client";
import { ControlsPanel } from "./components/ControlsPanel";
import { GraphView, type GraphSelection, type RenderedCounts } from "./components/GraphView";
import { EdgePanel, NodePanel } from "./components/Panels";
import { EmptyState, ErrorBox, Loading } from "./components/Status";
import { useAsync } from "./hooks/useAsync";
import { todayUtc, type Ymd } from "./lib/dates";

const EMPTY_TEXT = "No day has been ingested yet. The graph appears after the first daily ingestion succeeds.";

export interface Summary {
  transactions: number;
  counts: RenderedCounts | null;
}

function NoData() {
  return (
    <div className="status status-nodata" data-testid="no-data">
      <p>No data available</p>
    </div>
  );
}

function NothingIngested() {
  return <EmptyState title="No data yet"><p>{EMPTY_TEXT}</p></EmptyState>;
}

function GraphArea({ day, onSummary }: { day: Ymd; onSummary: (s: Summary | null) => void }) {
  const graph = useAsync(() => api.graph(day), [day]);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [counts, setCounts] = useState<RenderedCounts | null>(null);
  const data = graph.status === "success" ? graph.data : null;

  useEffect(() => {
    onSummary(data ? { transactions: data.transaction_count, counts } : null);
    return () => onSummary(null);
  }, [data, counts, onSummary]);

  const panel = useMemo(() => {
    if (!selection || !data) return null;
    const close = () => setSelection(null);
    return selection.kind === "node" ? (
      <NodePanel key={selection.address} day={data.day} address={selection.address} onClose={close} />
    ) : (
      <EdgePanel key={`${selection.source}>${selection.target}`} day={data.day} source={selection.source}
                 target={selection.target} onClose={close} />
    );
  }, [selection, data]);

  if (graph.status === "loading") return <Loading label="Loading graph…" />;
  if (graph.status === "error") {
    if (isEmptyState(graph.error)) return <NothingIngested />;
    if (graph.error instanceof ApiError && graph.error.code === "day_not_ingested") return <NoData />;
    return <ErrorBox error={graph.error} onRetry={graph.reload} what="the graph" />;
  }
  return (
    <div className={`workspace${panel ? " with-panel" : ""}`}>
      <section className="graph-section">
        <GraphView
          graph={graph.data}
          selection={selection}
          onNodeClick={(address) => setSelection({ kind: "node", address })}
          onEdgeClick={(source, target) => setSelection({ kind: "edge", source, target })}
          onRendered={setCounts}
        />
      </section>
      {panel}
    </div>
  );
}

export function App() {
  const days = useAsync(() => api.days(), []);
  const [picked, setPicked] = useState<Ymd | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const onSummary = useCallback((s: Summary | null) => setSummary(s), []);
  const today = todayUtc();

  const list = days.status === "success" ? days.data : [];
  const ingested = useMemo(() => new Set(list.map((d) => d.date)), [list]);
  const latest = list[0]?.date ?? null; // /api/days is newest first
  const selected = picked ?? latest;

  let content: React.ReactNode;
  if (days.status === "loading") content = <Loading label="Loading days…" />;
  else if (days.status === "error")
    content = isEmptyState(days.error) ? <NothingIngested />
      : <ErrorBox error={days.error} onRetry={days.reload} what="the list of days" />;
  else if (!selected) content = <NothingIngested />;
  else if (!ingested.has(selected)) content = <NoData />;
  else content = <GraphArea key={selected} day={selected} onSummary={onSummary} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="logo">BitFlow</h1>
        {summary && (
          <p className="graph-summary" data-testid="graph-summary">
            <span data-testid="summary-day">{selected}</span>{" · "}
            {summary.transactions} transactions
            {summary.counts && (
              <>
                {" · "}
                <span data-testid="rendered-nodes">{summary.counts.nodes}</span> addresses{" · "}
                <span data-testid="rendered-edges">{summary.counts.edges}</span> edges
              </>
            )}
          </p>
        )}
      </header>
      <div className="body">
        <ControlsPanel
          selected={selected}
          onSelect={setPicked}
          today={today}
          ingestedDays={ingested}
          daysStatus={days.status === "error" && isEmptyState(days.error) ? "success" : days.status}
        />
        <main className="main">{content}</main>
      </div>
    </div>
  );
}
