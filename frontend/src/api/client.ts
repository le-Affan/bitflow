import type { AddressSummary, Day, EdgeDetail, Graph, TransactionDetail } from "./types";

/** Error from the backend API or the network, normalized to one shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number | null, // null: no HTTP response (network failure)
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const NO_INGESTED_DAYS = "no_ingested_days";
export const NO_ELIGIBLE_TRANSACTIONS = "no_eligible_transactions";

export function isEmptyState(error: unknown): boolean {
  return error instanceof ApiError && error.code === NO_INGESTED_DAYS;
}

/** A day that was checked and had 0 eligible transactions (200 with an empty graph), as opposed to a stored day. */
export function isCheckedEmptyDay(graph: Graph): boolean {
  return graph.status === NO_ELIGIBLE_TRANSACTIONS;
}

type Fetch = typeof fetch;

/** Turns a non-2xx response body into an ApiError. Handles both backend error shapes. */
export function toApiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  // 404 (and other app errors): {"detail": {"code": "...", "message": "..."}}
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const { code, message } = detail as { code?: unknown; message?: unknown };
    if (typeof code === "string" && typeof message === "string") return new ApiError(status, code, message);
  }
  // 422: FastAPI default {"detail": [{"loc": [...], "msg": "...", ...}]}
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: unknown };
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : undefined;
        return typeof item.msg === "string" ? (field ? `${String(field)}: ${item.msg}` : item.msg) : null;
      })
      .filter((m): m is string => m !== null);
    return new ApiError(status, "validation_error", messages.join("; ") || "Invalid request.");
  }
  if (typeof detail === "string") return new ApiError(status, "http_error", detail);
  return new ApiError(status, "http_error", `Request failed with HTTP ${status}.`);
}

export function createApiClient(baseUrl: string, fetchImpl: Fetch = (...args) => fetch(...args)) {
  const base = baseUrl.replace(/\/+$/, "");

  async function get<T>(path: string, params: Record<string, string | undefined> = {}, signal?: AbortSignal): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, v);
    const qs = query.toString();
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}${qs ? `?${qs}` : ""}`, { headers: { Accept: "application/json" }, signal });
    } catch (e) {
      throw new ApiError(null, "network_error", `Could not reach the BitFlow API (${(e as Error).message}).`);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new ApiError(response.status, "invalid_response", "The API returned invalid JSON.");
    }
    if (!response.ok) throw toApiError(response.status, body);
    return body as T;
  }

  const enc = encodeURIComponent;
  return {
    days: () => get<Day[]>("/api/days"),
    graph: (day?: string, signal?: AbortSignal) => get<Graph>("/api/graph", { day }, signal),
    address: (day: string, address: string) => get<AddressSummary>(`/api/addresses/${enc(address)}`, { day }),
    edge: (day: string, source: string, target: string) => get<EdgeDetail>("/api/edges", { day, source, target }),
    transaction: (day: string, txid: string) => get<TransactionDetail>(`/api/transactions/${enc(txid)}`, { day }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "");
