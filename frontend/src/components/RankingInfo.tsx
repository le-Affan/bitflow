import { useEffect, useId, useRef, useState } from "react";

/** How the shown transactions are chosen (docs/BitFlow_PRD.md, "Ranking update"). */
const RULES = [
  "Transactions are ranked by their largest output that goes to an address that is not one of the transaction's own input addresses. Money sent back to the sender (change) is ignored.",
  "Only transactions with at least one input address and at least one such output are considered. Coinbase (mining reward) transactions are excluded.",
  "Outputs without a standard address (like OP_RETURN) or with several addresses (like multisig) are not shown.",
  "Ties are broken by transaction ID, lowest first.",
  "A day is a UTC day. For a date range, the top 100 are chosen across all days in the range.",
];

/** Small "i" button; its tooltip opens on hover, keyboard focus or tap, and closes on Escape or a tap elsewhere. */
export function RankingInfo() {
  const [pinned, setPinned] = useState(false); // opened by a tap/click, independent of hover and focus
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  return (
    <span className={`info${pinned ? " open" : ""}`} ref={rootRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPinned(false);
              (e.target as HTMLElement).blur();
            }
          }}>
      <button type="button" className="info-button" aria-label="How the top 100 are picked" aria-describedby={tipId}
              aria-expanded={pinned} onClick={() => setPinned((p) => !p)} data-testid="ranking-info">
        i
      </button>
      <span role="tooltip" id={tipId} className="info-tip" data-testid="ranking-info-tip">
        <strong>How the top 100 are picked</strong>
        <ul>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </span>
    </span>
  );
}
