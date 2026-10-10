import { useCallback, useEffect, useState } from "react";

import type { Ymd } from "../lib/dates";
import { DatePicker } from "./DatePicker";

const COMING_SOON = "Date range selection coming soon";
const BUBBLE_MS = 3000;

type Anchor = "week" | "month" | "year" | "custom";

interface Props {
  selected: Ymd | null;
  onSelect: (day: Ymd) => void;
  today: Ymd;
  ingestedDays: ReadonlySet<Ymd>;
  daysStatus: "loading" | "error" | "success";
}

/** Small non-blocking bubble (role="status") that hides itself after a few seconds. */
function ComingSoonBubble({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, BUBBLE_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="bubble" role="status" data-testid="coming-soon">
      <span>{COMING_SOON}</span>
      <button type="button" className="bubble-close" aria-label="Dismiss message" onClick={onDismiss}>×</button>
    </div>
  );
}

export function ControlsPanel({ selected, onSelect, today, ingestedDays, daysStatus }: Props) {
  const [bubble, setBubble] = useState<{ anchor: Anchor; n: number } | null>(null);
  const [from, setFrom] = useState<Ymd | null>(null);
  const [to, setTo] = useState<Ymd | null>(null);
  const show = (anchor: Anchor) => setBubble((b) => ({ anchor, n: (b?.n ?? 0) + 1 }));
  const dismiss = useCallback(() => setBubble(null), []);
  const bubbleAt = (anchor: Anchor) =>
    bubble?.anchor === anchor ? <ComingSoonBubble key={bubble.n} onDismiss={dismiss} /> : null;

  return (
    <aside className="controls" aria-label="Controls" data-testid="controls-panel">
      <section className="control-group">
        <h2>Day (UTC)</h2>
        <DatePicker label="Day" value={selected} onChange={onSelect} today={today} markedDays={ingestedDays}
                    testId="day-picker" />
        <p className="muted small">
          {daysStatus === "loading" && "Loading ingested days…"}
          {daysStatus === "error" && "Could not load the list of ingested days."}
          {daysStatus === "success" &&
            (ingestedDays.size === 0 ? "No day has been ingested yet." : `${ingestedDays.size} ingested day${ingestedDays.size === 1 ? "" : "s"}, marked with a dot.`)}
        </p>
      </section>

      <section className="control-group" aria-label="Date range (coming soon)">
        <h2>Date range</h2>
        {(["week", "month", "year"] as const).map((r) => (
          <div className="bubble-anchor" key={r}>
            <button type="button" className="range-button" onClick={() => show(r)}>
              {{ week: "Past week", month: "Past month", year: "Past year" }[r]}
            </button>
            {bubbleAt(r)}
          </div>
        ))}
        <h3>Custom range</h3>
        <div className="custom-range">
          <span className="field-label" id="range-from-label">From</span>
          <DatePicker label="From" value={from} onChange={setFrom} today={today} compact testId="range-from" />
          <span className="field-label" id="range-to-label">To</span>
          <DatePicker label="To" value={to} onChange={setTo} today={today} compact testId="range-to" />
        </div>
        <div className="bubble-anchor">
          <button type="button" className="range-button primary" onClick={() => show("custom")}>Apply</button>
          {bubbleAt("custom")}
        </div>
      </section>
    </aside>
  );
}
