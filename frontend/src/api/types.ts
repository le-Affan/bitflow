// Shapes of the BitFlow backend API (backend/app/api/schemas.py). Amounts are integer satoshis.

export interface Day {
  date: string;
  transaction_count: number;
  ingested_at: string;
}

export interface GraphNode {
  address: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  tx_count: number;
}

export interface Graph {
  day: string;
  transaction_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Only present for a day that was checked and had 0 eligible transactions. */
  status?: string;
}

export interface AddressSummary {
  day: string;
  address: string;
  transaction_count: number;
  spent_sat: number;
  received_sat: number;
  scope: string;
}

export interface EdgeTransaction {
  txid: string;
  block_height: number;
  block_time: string;
  amount_to_target_sat: number;
}

export interface EdgeDetail {
  day: string;
  source: string;
  target: string;
  transactions: EdgeTransaction[];
}

export interface TxPart {
  position: number;
  address: string;
  value_sat: number;
}

export interface TransactionDetail {
  day: string;
  txid: string;
  block_height: number;
  block_time: string;
  inputs: TxPart[];
  outputs: TxPart[];
}
