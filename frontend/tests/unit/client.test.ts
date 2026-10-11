import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient, isCheckedEmptyDay, isEmptyState, scopeLabel, toApiError } from "../../src/api/client";

// fetch is mocked in every test; all dates, addresses and counts below are synthetic.
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("API client", () => {
  it("builds URLs with the base URL and query parameters", async () => {
    const fetchMock = vi.fn(async () => json(200, []));
    const client = createApiClient("http://api.test:8000/", fetchMock);
    await client.days();
    await client.graph();
    await client.graph("2026-10-09");
    await client.edge("2026-10-09", "a b", "c&d");
    await client.address("2026-10-09", "bc1q/x");
    const urls = fetchMock.mock.calls.map((c) => (c as unknown[])[0]);
    expect(urls).toEqual([
      "http://api.test:8000/api/days",
      "http://api.test:8000/api/graph",
      "http://api.test:8000/api/graph?day=2026-10-09",
      "http://api.test:8000/api/edges?day=2026-10-09&source=a+b&target=c%26d",
      "http://api.test:8000/api/addresses/bc1q%2Fx?day=2026-10-09",
    ]);
  });

  it("sends a range as start and end", async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    const client = createApiClient("", fetchMock);
    const range = { start: "2001-02-01", end: "2001-02-28" };
    await client.graph(range);
    await client.edge(range, "fx-a", "fx-b");
    await client.transaction(range, "ab");
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "/api/graph?start=2001-02-01&end=2001-02-28",
      "/api/edges?start=2001-02-01&end=2001-02-28&source=fx-a&target=fx-b",
      "/api/transactions/ab?start=2001-02-01&end=2001-02-28",
    ]);
    expect(scopeLabel(range)).toBe("2001-02-01 to 2001-02-28");
    expect(scopeLabel("2001-02-01")).toBe("2001-02-01");
  });

  it("returns parsed JSON on success", async () => {
    const days = [{ date: "2026-10-09", transaction_count: 100, ingested_at: "2026-10-10T19:40:42Z" }];
    const client = createApiClient("", vi.fn().mockResolvedValue(json(200, days)));
    expect(await client.days()).toEqual(days);
  });

  it("maps the 404 shape {detail: {code, message}}", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(
      json(404, { detail: { code: "day_not_ingested", message: "Day 2026-10-01 has not been ingested." } })));
    const err = await client.graph("2026-10-01").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "day_not_ingested", message: "Day 2026-10-01 has not been ingested." });
    expect(isEmptyState(err)).toBe(false);
  });

  it("recognises the empty state (404 no_ingested_days)", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(
      json(404, { detail: { code: "no_ingested_days", message: "No day has been ingested yet." } })));
    const err = await client.graph().catch((e) => e);
    expect(isEmptyState(err)).toBe(true);
    expect(err.message).toBe("No day has been ingested yet.");
  });

  it("maps the 422 shape {detail: [{loc, msg}]}", async () => {
    const body = { detail: [{ type: "date_from_datetime_parsing", loc: ["query", "day"], msg: "Input should be a valid date" }] };
    const client = createApiClient("", vi.fn().mockResolvedValue(json(422, body)));
    const err = await client.graph("nope").catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: "validation_error", message: "day: Input should be a valid date" });
  });

  it("maps unknown error bodies and non-JSON errors", () => {
    expect(toApiError(500, null)).toMatchObject({ status: 500, code: "http_error" });
    expect(toApiError(500, { detail: "Internal" })).toMatchObject({ code: "http_error", message: "Internal" });
    expect(toApiError(422, { detail: [] })).toMatchObject({ code: "validation_error", message: "Invalid request." });
  });

  it("handles a 502 with an HTML body", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })));
    await expect(client.days()).rejects.toMatchObject({ status: 502, code: "http_error" });
  });

  it("maps network failures", async () => {
    const client = createApiClient("", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(client.days()).rejects.toMatchObject({ status: null, code: "network_error" });
  });

  it("rejects invalid JSON on success", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(client.days()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("graph day states", () => {
  it("tells a checked-empty day (200 + status) apart from a stored day", async () => {
    const empty = { day: "2001-02-03", transaction_count: 0, nodes: [], edges: [], status: "no_eligible_transactions" };
    const stored = { day: "2001-02-04", transaction_count: 1, nodes: [{ address: "fx-a" }, { address: "fx-b" }],
                     edges: [{ source: "fx-a", target: "fx-b", tx_count: 1 }] };
    const client = createApiClient("", vi.fn(async (url: RequestInfo | URL) => json(200, String(url).includes("02-03") ? empty : stored)));
    expect(isCheckedEmptyDay(await client.graph("2001-02-03"))).toBe(true);
    expect(isCheckedEmptyDay(await client.graph("2001-02-04"))).toBe(false);
  });

  it("passes the abort signal to fetch, so an outdated graph request can be cancelled", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const controller = new AbortController();
    const pending = createApiClient("", fetchMock).graph("2001-02-03", controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: controller.signal });
  });
});
