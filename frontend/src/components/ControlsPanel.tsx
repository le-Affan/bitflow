import { useState } from "react";

import { addDays, FIRST_BITCOIN_DAY, type Ymd } from "../lib/dates";
import { DatePicker } from "./DatePicker";

export interface DayRange {
  start: Ymd;
  end: Ymd;
}

/** Preset ranges: this many days, ending on (and including) the latest stored day. */
export const PRESETS = [
  { label: "Past week", days: 7 },
  { label: "Past month", days: 30 },
  { label: "Past year", days: 365 },
] as const;

export function presetRange(latest: Ymd, days: number): DayRange {
  return { start: addDays(latest, -(days - 1)), end: latest };
}

/**
 * Checks a custom From/To range. A start before the first Bitcoin block is moved to that day (unless the whole
 * range is before it, which the app then shows as such).
 */
export function customRange(from: Ymd | null, to: Ymd | null): DayRange | { error: string } {
  if (!from || !to) return { error: "Choose both From and To." };
  if (from > to) return { error: "From must not be after To." };
  if (from < FIRST_BITCOIN_DAY && to >= FIRST_BITCOIN_DAY) return { start: FIRST_BITCOIN_DAY, end: to };
  return { start: from, end: to };
}

const sameRange = (a: DayRange | null, b: DayRange) => !!a && a.start === b.start && a.end === b.end;

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selected: Ymd | null; // the day shown, or null while a range is shown
  onSelect: (day: Ymd) => void;
  range: DayRange | null; // the range shown, if any
  onSelectRange: (range: DayRange) => void;
  latest: Ymd | null; // latest stored day; presets end on it
  today: Ymd;
  ingestedDays: ReadonlySet<Ymd>;
  daysStatus: "loading" | "error" | "success";
}

export function ControlsPanel(props: Props) {
  const { collapsed, onToggleCollapsed, selected, onSelect, range, onSelectRange, latest, today, ingestedDays,
          daysStatus } = props;
  const [from, setFrom] = useState<Ymd | null>(null);
  const [to, setTo] = useState<Ymd | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const r = customRange(from, to);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setFrom(r.start); // shows a clamped start
    onSelectRange(r);
  };

  return (
    <aside className={`controls${collapsed ? " collapsed" : ""}`} aria-label="Controls" data-testid="controls-panel">
      <button type="button" className="icon-button collapse-toggle" onClick={onToggleCollapsed}
              aria-expanded={!collapsed} aria-controls="controls-content"
              aria-label={collapsed ? "Expand controls" : "Collapse controls"} title={collapsed ? "Expand controls" : "Collapse controls"}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div className="controls-content" id="controls-content" hidden={collapsed}>
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

      <section className="control-group" aria-label="Date range">
        <h2>Date range</h2>
        {PRESETS.map(({ label, days }) => {
          const r = latest ? presetRange(latest, days) : null;
          return (
            <button key={label} type="button" className="range-button" disabled={!r}
                    aria-pressed={!!r && sameRange(range, r)} title={r ? `${r.start} to ${r.end}` : undefined}
                    onClick={() => r && onSelectRange(r)}>
              {label}
            </button>
          );
        })}
        <p className="muted small">{latest ? `${PRESETS.map((p) => p.days).join(", ")} days ending on ${latest}, the latest stored day.` : ""}</p>
        <h3>Custom range</h3>
        <div className="custom-range">
          <span className="field-label" id="range-from-label">From</span>
          <DatePicker label="From" value={from} onChange={setFrom} today={today} compact testId="range-from" />
          <span className="field-label" id="range-to-label">To</span>
          <DatePicker label="To" value={to} onChange={setTo} today={today} compact testId="range-to" />
        </div>
        {error && <p className="field-error small" role="alert" data-testid="range-error">{error}</p>}
        <button type="button" className="range-button primary" onClick={apply}
                aria-pressed={!!range && !PRESETS.some((p) => latest && sameRange(range, presetRange(latest, p.days)))}>
          Apply
        </button>
      </section>
      </div>
    </aside>
  );
}
