import { useEffect, useId, useRef, useState } from "react";

import {
  addDays, addMonths, clampYearMonth, compareYearMonth, isSelectable, longLabel, MONTH_NAMES, monthGrid, moveToMonth,
  WEEKDAY_SHORT, weekdayIndex, yearMonthOf, type Ymd, type YearMonth,
} from "../lib/dates";

interface Props {
  label: string;
  value: Ymd | null;
  onChange: (value: Ymd) => void;
  today: Ymd; // UTC; nothing after it can be selected
  markedDays?: ReadonlySet<Ymd>; // days with ingested data
  placeholder?: string;
  testId?: string;
  compact?: boolean;
}

/** Dropdown button with a calendar popover. Future days (after `today`, UTC) are disabled. */
export function DatePicker({ label, value, onChange, today, markedDays, placeholder = "Select a date", testId, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<Ymd>(value && isSelectable(value, today) ? value : today);
  const [view, setView] = useState<YearMonth>(yearMonthOf(focused));
  const [yearText, setYearText] = useState(String(view.year));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const moveFocusRef = useRef(false);
  const popId = useId();
  const max = yearMonthOf(today);

  // Opening resets the view to the selected day (or today).
  const openPicker = () => {
    const start = value && isSelectable(value, today) ? value : today;
    setFocused(start);
    setView(yearMonthOf(start));
    setYearText(String(yearMonthOf(start).year));
    moveFocusRef.current = true;
    setOpen(true);
  };
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && moveFocusRef.current) {
      moveFocusRef.current = false;
      gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focused}"]`)?.focus();
    }
  }, [open, focused, view]);

  const showMonth = (ym: YearMonth) => {
    const target = clampYearMonth(ym, today);
    setView(target);
    setYearText(String(target.year));
    setFocused(moveToMonth(focused, target, today));
  };

  const focusDay = (day: Ymd) => {
    const next = day > today ? today : day; // never move focus onto a future day
    if (next < "0001-01-01") return;
    setFocused(next);
    setView(yearMonthOf(next));
    setYearText(String(yearMonthOf(next).year));
    moveFocusRef.current = true;
  };

  const select = (day: Ymd) => {
    if (!isSelectable(day, today)) return; // future or invalid: ignored by every route
    onChange(day);
    close();
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => Ymd> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekdayIndex(focused)),
      End: () => addDays(focused, 6 - weekdayIndex(focused)),
      PageUp: () => moveToMonth(focused, addMonths(yearMonthOf(focused), e.shiftKey ? -12 : -1), today),
      PageDown: () => moveToMonth(focused, addMonths(yearMonthOf(focused), e.shiftKey ? 12 : 1), today),
    };
    if (moves[e.key]) {
      e.preventDefault();
      focusDay(moves[e.key]());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(focused);
    }
  };

  const onYearCommit = () => {
    const year = Number.parseInt(yearText, 10);
    if (!Number.isFinite(year)) {
      setYearText(String(view.year));
      return;
    }
    showMonth({ year: Math.min(Math.max(year, 1), max.year), month: view.month });
  };

  const weeks = monthGrid(view);
  const atMax = compareYearMonth(view, max) >= 0;

  return (
    <div className={`date-picker${compact ? " compact" : ""}`} ref={rootRef} data-testid={testId}>
      <button
        ref={buttonRef}
        type="button"
        className="date-picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${label}: ${value ? longLabel(value) : placeholder}`}
        data-value={value ?? ""}
        onClick={() => (open ? close() : openPicker())}
      >
        <span>{value ?? placeholder}</span>
        <span aria-hidden="true" className="caret">▾</span>
      </button>
      {open && (
        <div
          id={popId}
          className="calendar"
          role="dialog"
          aria-label={`${label}: choose a date`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="calendar-nav">
            <button type="button" aria-label="Previous month" onClick={() => showMonth(addMonths(view, -1))}
                    disabled={view.year === 1 && view.month === 1}>‹</button>
            <select aria-label="Month" value={view.month}
                    onChange={(e) => showMonth({ year: view.year, month: Number(e.target.value) })}>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1} disabled={view.year === max.year && i + 1 > max.month}>{name}</option>
              ))}
            </select>
            <input aria-label="Year" type="number" inputMode="numeric" min={1} max={max.year} value={yearText}
                   onChange={(e) => setYearText(e.target.value)} onBlur={onYearCommit}
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onYearCommit(); } }} />
            <button type="button" aria-label="Next month" onClick={() => showMonth(addMonths(view, 1))} disabled={atMax}>›</button>
          </div>
          <table className="calendar-grid" role="grid" aria-label={`${MONTH_NAMES[view.month - 1]} ${view.year}`}
                 ref={gridRef} onKeyDown={onGridKey}>
            <thead>
              <tr>{WEEKDAY_SHORT.map((d) => <th key={d} scope="col" abbr={d}>{d}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((day, di) => {
                    if (!day) return <td key={di} />;
                    const future = day > today;
                    const marked = markedDays?.has(day) ?? false;
                    const label = `${longLabel(day)}${marked ? ", has data" : ""}${future ? ", not selectable (future)" : ""}`;
                    return (
                      <td key={di} role="gridcell" aria-selected={day === value}>
                        <button
                          type="button"
                          data-date={day}
                          className={["day", marked && "marked", day === value && "selected", day === today && "today"]
                            .filter(Boolean).join(" ")}
                          tabIndex={day === focused ? 0 : -1}
                          disabled={future}
                          aria-disabled={future}
                          aria-label={label}
                          onClick={() => select(day)}
                          onFocus={() => setFocused(day)}
                        >
                          {Number(day.slice(8))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="calendar-footer">
            {markedDays && <span className="legend"><span className="dot" aria-hidden="true" /> day with data</span>}
            <button type="button" className="link" onClick={() => select(today)}>Today (UTC)</button>
          </div>
        </div>
      )}
    </div>
  );
}
