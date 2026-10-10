import { useState } from "react";

import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { formatBtc } from "../lib/btc";
import { shorten } from "../lib/shorten";
import { formatUtc } from "../lib/time";
import { FullValue, ShortValue } from "./Address";
import { ErrorBox, Loading } from "./Status";

function PanelShell(props: { title: string; onClose: () => void; closing?: boolean; children: React.ReactNode }) {
  const { title, onClose, closing, children } = props;
  return (
    <aside className={`panel${closing ? " closing" : ""}`} aria-label={title} data-testid="side-panel">
      <header className="panel-header">
        <h2>{title}</h2>
        <button type="button" className="close" onClick={onClose} aria-label="Close panel">×</button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

export function NodePanel(props: { day: string; address: string; onClose: () => void; closing?: boolean }) {
  const { day, address, onClose, closing } = props;
  const s = useAsync(() => api.address(day, address), [day, address]);
  return (
    <PanelShell title="Address" onClose={onClose} closing={closing}>
      <FullValue value={address} />
      {s.status === "loading" && <Loading />}
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
    </PanelShell>
  );
}

export function EdgePanel(props: { day: string; source: string; target: string; onClose: () => void; closing?: boolean }) {
  const { day, source, target, onClose, closing } = props;
  const [txid, setTxid] = useState<string | null>(null);
  const s = useAsync(() => api.edge(day, source, target), [day, source, target]);

  if (txid) {
    return (
      <PanelShell title="Transaction" onClose={onClose} closing={closing}>
        <button type="button" className="link" onClick={() => setTxid(null)}>← Back to edge</button>
        <TransactionDetails day={day} txid={txid} />
      </PanelShell>
    );
  }
  return (
    <PanelShell title="Edge" onClose={onClose} closing={closing}>
      <dl className="facts">
        <dt>From</dt>
        <dd><ShortValue value={source} /></dd>
        <dt>To</dt>
        <dd><ShortValue value={target} /></dd>
      </dl>
      {s.status === "loading" && <Loading />}
      {s.status === "error" && <ErrorBox error={s.error} onRetry={s.reload} what="the edge's transactions" />}
      {s.status === "success" && (
        <>
          <h3 data-testid="edge-tx-heading">
            {s.data.transactions.length} transaction{s.data.transactions.length === 1 ? "" : "s"}
          </h3>
          <p className="muted small">Amount = what each transaction paid to {shorten(target)}.</p>
          <ul className="tx-list" data-testid="edge-tx-list">
            {s.data.transactions.map((t) => (
              <li key={t.txid}>
                <button type="button" className="tx-row" onClick={() => setTxid(t.txid)} data-testid="edge-tx">
                  <code title={t.txid}>{shorten(t.txid, 8, 6)}</code>
                  <span className="muted">{formatUtc(t.block_time)}</span>
                  <span className="amount">{formatBtc(t.amount_to_target_sat)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
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

export function TransactionDetails({ day, txid }: { day: string; txid: string }) {
  const s = useAsync(() => api.transaction(day, txid), [day, txid]);
  return (
    <div data-testid="tx-details">
      <FullValue value={txid} />
      {s.status === "loading" && <Loading />}
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
  );
}
