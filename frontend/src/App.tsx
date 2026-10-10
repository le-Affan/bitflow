import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, isEmptyState } from "./api/client";
import { ControlsPanel } from "./components/ControlsPanel";
import { GraphView, prefersReducedMotion, type GraphSelection, type RenderedCounts } from "./components/GraphView";
import { EdgePanel, NodePanel } from "./components/Panels";
import { EmptyState, ErrorBox, Loading } from "./components/Status";
import { useAsync } from "./hooks/useAsync";
import { todayUtc, type Ymd } from "./lib/dates";
import { applyTheme, loadTheme, saveTheme, type Theme } from "./lib/theme";

const PANEL_EXIT_MS = 260; // matches the CSS close transition (250 ms) plus a frame

const EMPTY_TEXT = "No day has been ingested yet. The graph appears after the first daily ingestion succeeds.";

export interface Summary {
  transactions: number;
  counts: RenderedCounts | null;
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button type="button" className="icon-button theme-toggle" onClick={onToggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} aria-pressed={dark}
            title={dark ? "Light theme" : "Dark theme"}>
      {dark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      )}
    </button>
  );
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

function GraphArea({ day, onSummary, theme }: { day: Ymd; onSummary: (s: Summary | null) => void; theme: Theme }) {
  const graph = useAsync(() => api.graph(day), [day]);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [counts, setCounts] = useState<RenderedCounts | null>(null);
  // The panel slot stays mounted and animates its width. While it closes, the last selection keeps being shown
  // so the content stays visible during the exit; it is dropped once the exit animation is over.
  const [lastShown, setLastShown] = useState<GraphSelection>(null);
  useEffect(() => {
    if (selection) {
      setLastShown(selection);
      return;
    }
    const t = window.setTimeout(() => setLastShown(null), prefersReducedMotion() ? 0 : PANEL_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [selection]);
  const shown = selection ?? lastShown;
  const closePanel = useCallback(() => setSelection(null), []);
  const data = graph.status === "success" ? graph.data : null;

  useEffect(() => {
    onSummary(data ? { transactions: data.transaction_count, counts } : null);
    return () => onSummary(null);
  }, [data, counts, onSummary]);

  const panel = useMemo(() => {
    if (!shown || !data) return null;
    return shown.kind === "node" ? (
      <NodePanel day={data.day} address={shown.address} onClose={closePanel} />
    ) : (
      <EdgePanel day={data.day} source={shown.source} target={shown.target} onClose={closePanel} />
    );
  }, [shown, data, closePanel]);

  if (graph.status === "loading") return <Loading label="Loading graph…" />;
  if (graph.status === "error") {
    if (isEmptyState(graph.error)) return <NothingIngested />;
    if (graph.error instanceof ApiError && graph.error.code === "day_not_ingested") return <NoData />;
    return <ErrorBox error={graph.error} onRetry={graph.reload} what="the graph" />;
  }
  return (
    <div className="workspace">
      <section className="graph-section">
        <GraphView
          graph={graph.data}
          selection={selection}
          onNodeClick={(address) => setSelection({ kind: "node", address })}
          onEdgeClick={(source, target) => setSelection({ kind: "edge", source, target })}
          onBackgroundClick={() => selection && closePanel()}
          onRendered={setCounts}
          theme={theme}
        />
      </section>
      <div className={`panel-slot${selection ? " open" : ""}`} aria-hidden={!selection} inert={!selection}>
        <div className="panel-slot-inner">{panel}</div>
      </div>
    </div>
  );
}

export function App() {
  const days = useAsync(() => api.days(), []);
  const [picked, setPicked] = useState<Ymd | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  };
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
  else content = <GraphArea key={selected} day={selected} onSummary={onSummary} theme={theme} />;

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
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>
      <div className="body">
        <ControlsPanel
          collapsed={controlsCollapsed}
          onToggleCollapsed={() => setControlsCollapsed((c) => !c)}
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
