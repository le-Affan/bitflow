import { ApiError } from "../api/client";

export function Loading({ label = "Loading…" }: { label?: string }) {
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
