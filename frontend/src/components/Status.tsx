import { useEffect, useState } from "react";

import { ApiError } from "../api/client";

/** Loading indicator. With `delayMs`, nothing is shown for fast responses, so panels don't flicker. */
export function Loading({ label = "Loading…", delayMs = 0 }: { label?: string; delayMs?: number }) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!visible) return <div className="status-placeholder" aria-busy="true" />;
  return (
    <div className="status status-loading" role="status" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <div className="status status-error" role="alert">
      <p>
        <strong>Could not load {what}.</strong>
      </p>
      <p className="muted">{message}</p>
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="status status-empty" data-testid="empty-state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
