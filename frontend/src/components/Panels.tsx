import { useEffect, useState } from "react";

import { api, scopeLabel } from "../api/client";
import type { Scope } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { formatBtc } from "../lib/btc";
import { shorten } from "../lib/shorten";
import { formatUtc } from "../lib/time";
import { AddressChip, FullValue, ShortValue } from "./Address";
import { ErrorBox, Loading } from "./Status";

const LOADER_DELAY_MS = 150;

function PanelShell(props: {
  title: string;
  onBack?: () => void; // only second-level panels (transaction) have a back arrow
  onClose: () => void;
  contentKey: string; // a new key crossfades the body (content change inside an open panel)
  children: React.ReactNode;
}) {
  const { title, onBack, onClose, contentKey, children } = props;
  return (
    <aside className="panel" aria-label={title} data-testid="side-panel">
      <header className={`panel-header${onBack ? " with-back" : ""}`}>
        {onBack && (
          <button type="button" className="icon-button back" onClick={onBack} aria-label="Back" title="Back">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          </button>
        )}
        <h2>{title}</h2>
        <button type="button" className="close" onClick={onClose} aria-label="Close panel">×</button>
      </header>
      <div className="panel-body" key={contentKey}>{children}</div>
    </aside>
  );
}

export function NodePanel(props: { scope: Scope; address: string; onClose: () => void }) {
  const { scope, address, onClose } = props;
  const s = useAsync(() => api.address(scope, address), [scopeLabel(scope), address]);
  return (
    <PanelShell title="Address" onClose={onClose} contentKey={`node:${address}`}>
      <FullValue value={address} />
      <div className="panel-content">
        {s.status === "loading" && <Loading delayMs={LOADER_DELAY_MS} />}
        {s.status === "error" && <ErrorBox error={s.error} onRetry={s.reload} what="address details" />}
        {s.status === "success" && (
          <>
            <dl className="facts" data-testid="address-facts">
              <dt>Transactions</dt>
              <dd data-testid="address-tx-count">{s.data.transaction_count}</dd>
              <dt>Total sent</dt>
              <dd data-testid="address-sent">{formatBtc(s.data.spent_sat)}</dd>
              <dt>Total received</dt>
              <dd data-testid="address-received">{formatBtc(s.data.received_sat)}</dd>
            </dl>
            <p className="scope" data-testid="address-scope">{s.data.scope}</p>
          </>
        )}
      </div>
    </PanelShell>
  );
}

function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
  );
}

export function EdgePanel(props: { scope: Scope; source: string; target: string; onClose: () => void }) {
  const { scope, source, target, onClose } = props;
  const key = scopeLabel(scope);
  const [txid, setTxid] = useState<string | null>(null);
  const s = useAsync(() => api.edge(scope, source, target), [key, source, target]);
  useEffect(() => setTxid(null), [key, source, target]); // a different edge starts at its list

  if (txid) {
    return (
      <PanelShell title="Transaction" onBack={() => setTxid(null)} onClose={onClose} contentKey={`tx:${txid}`}>
        <TransactionDetails scope={scope} txid={txid} />
      </PanelShell>
    );
  }
  const n = s.status === "success" ? s.data.transactions.length : null;
  return (
    <PanelShell title="Edge" onClose={onClose} contentKey={`edge:${source}>${target}`}>
      <div className="edge-route">
        <AddressChip role="From" value={source} />
        <svg className="route-arrow" viewBox="0 0 24 24" width="18" height="18" aria-label="to" role="img" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <AddressChip role="To" value={target} />
      </div>
      <div className="panel-content">
        {s.status === "loading" && <Loading delayMs={LOADER_DELAY_MS} />}
        {s.status === "error" && <ErrorBox error={s.error} onRetry={s.reload} what="the edge's transactions" />}
        {s.status === "success" && (
          <>
            <h3 className="edge-count" data-testid="edge-tx-heading">
              {n} transaction{n === 1 ? "" : "s"}
            </h3>
            <p className="edge-note">Amount = what each transaction paid to {shorten(target)}.</p>
            <ul className="tx-cards" data-testid="edge-tx-list">
              {s.data.transactions.map((t) => (
                <li key={t.txid}>
                  <button type="button" className="tx-card" onClick={() => setTxid(t.txid)} data-testid="edge-tx">
                    <span className="tx-main">
                      <code title={t.txid}>{shorten(t.txid, 8, 6)}</code>
                      <span className="tx-time">{formatUtc(t.block_time)}</span>
                    </span>
                    <span className="tx-amount">{formatBtc(t.amount_to_target_sat)}</span>
                    <Chevron />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </PanelShell>
  );
}

function PartList({ title, parts }: { title: string; parts: { position: number; address: string; value_sat: number }[] }) {
  return (
    <>
      <h3>{title} ({parts.length})</h3>
      <ul className="part-list">
        {parts.map((p) => (
          <li key={p.position}>
            <ShortValue value={p.address} />
            <span className="amount">{formatBtc(p.value_sat)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function TransactionDetails({ scope, txid }: { scope: Scope; txid: string }) {
  const s = useAsync(() => api.transaction(scope, txid), [scopeLabel(scope), txid]);
  return (
    <div data-testid="tx-details">
      <FullValue value={txid} />
      <div className="panel-content">
        {s.status === "loading" && <Loading delayMs={LOADER_DELAY_MS} />}
        {s.status === "error" && <ErrorBox error={s.error} onRetry={s.reload} what="the transaction" />}
        {s.status === "success" && (
          <>
            <dl className="facts">
              <dt>Block height</dt>
              <dd data-testid="tx-height">{s.data.block_height}</dd>
              <dt>Block time</dt>
              <dd>{formatUtc(s.data.block_time)}</dd>
            </dl>
            <p className="muted small">Only inputs and outputs with a standard address are stored and shown.</p>
            <PartList title="Inputs" parts={s.data.inputs} />
            <PartList title="Outputs" parts={s.data.outputs} />
          </>
        )}
      </div>
    </div>
  );
}
