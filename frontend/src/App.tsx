import { useMemo, useState } from "react";

import { api, isEmptyState } from "./api/client";
import { GraphView, type GraphSelection, type RenderedCounts } from "./components/GraphView";
import { EdgePanel, NodePanel } from "./components/Panels";
import { EmptyState, ErrorBox, Loading } from "./components/Status";
import { useAsync } from "./hooks/useAsync";

const EMPTY_TEXT = "No day has been ingested yet. The graph appears after the first daily ingestion succeeds.";

function GraphArea({ day }: { day: string }) {
  const graph = useAsync(() => api.graph(day), [day]);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [counts, setCounts] = useState<RenderedCounts | null>(null);
  const data = graph.status === "success" ? graph.data : null;

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
    if (isEmptyState(graph.error)) return <EmptyState title="No data yet"><p>{EMPTY_TEXT}</p></EmptyState>;
    return <ErrorBox error={graph.error} onRetry={graph.reload} what="the graph" />;
  }
  return (
    <div className={`workspace${panel ? " with-panel" : ""}`}>
      <section className="graph-section">
        <p className="graph-summary" data-testid="graph-summary">
          {graph.data.transaction_count} transactions
          {counts && (
            <>
              {" · "}
              <span data-testid="rendered-nodes">{counts.nodes}</span> addresses{" · "}
              <span data-testid="rendered-edges">{counts.edges}</span> edges
            </>
          )}
        </p>
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
  const [picked, setPicked] = useState<string | null>(null);
  const list = days.status === "success" ? days.data : [];
  const day = picked ?? list[0]?.date ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>BitFlow</h1>
        {days.status === "success" && list.length > 0 && (
          <label className="day-select">
            <span>UTC day</span>
            <select value={day ?? ""} onChange={(e) => setPicked(e.target.value)} data-testid="day-select">
              {list.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date} ({d.transaction_count} transactions)
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <main className="main">
        {days.status === "loading" && <Loading label="Loading days…" />}
        {days.status === "error" &&
          (isEmptyState(days.error) ? (
            <EmptyState title="No data yet"><p>{EMPTY_TEXT}</p></EmptyState>
          ) : (
            <ErrorBox error={days.error} onRetry={days.reload} what="the list of days" />
          ))}
        {days.status === "success" && list.length === 0 && (
          <EmptyState title="No data yet"><p>{EMPTY_TEXT}</p></EmptyState>
        )}
        {day && <GraphArea key={day} day={day} />}
      </main>
    </div>
  );
}
