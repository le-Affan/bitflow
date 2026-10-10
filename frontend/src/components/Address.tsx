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
