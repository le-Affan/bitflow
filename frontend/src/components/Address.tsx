import { useState } from "react";

import { shorten } from "../lib/shorten";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="copy" onClick={copy} aria-label={`${label} ${value}`} title={`Copy ${value}`}>
      {copied ? "Copied" : label}
    </button>
  );
}

/** Shortened address or txid with the full value in the tooltip and a copy button. */
export function ShortValue({ value }: { value: string }) {
  return (
    <span className="short-value">
      <code title={value}>{shorten(value)}</code>
      <CopyButton value={value} />
    </span>
  );
}

/** Full value (wrapping) with a copy button, for panel headers. */
export function FullValue({ value }: { value: string }) {
  return (
    <div className="full-value">
      <code>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

/** Small icon-only copy button (clipboard icon, check mark once copied). */
export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className={`icon-button copy-icon${copied ? " copied" : ""}`} onClick={copy}
            aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      {copied ? (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      )}
    </button>
  );
}

/** Address chip: role label, short address (full one in the tooltip) and an icon copy button. */
export function AddressChip({ role, value }: { role: string; value: string }) {
  return (
    <span className="address-chip">
      <span className="chip-role">{role}</span>
      <code title={value}>{shorten(value)}</code>
      <CopyIconButton value={value} label={`Copy ${role.toLowerCase()} address`} />
    </span>
  );
}
