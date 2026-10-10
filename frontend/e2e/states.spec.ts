import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { API, graphInfo, waitForGraph } from "./helpers";

// UI states with the API fully mocked by route interception. Never touches the real database.
// TEST FIXTURES: every date, address and count below is synthetic, not real chain data.
const fxDays = [
  { date: "2026-10-11", transaction_count: 1, ingested_at: "2026-10-12T01:10:00Z" },
  { date: "2026-10-10", transaction_count: 2, ingested_at: "2026-10-11T01:10:00Z" },
];
const fxGraphs: Record<string, unknown> = {
  "2026-10-11": { day: "2026-10-11", transaction_count: 1, nodes: [{ address: "fx-a" }, { address: "fx-b" }],
                  edges: [{ source: "fx-a", target: "fx-b", tx_count: 1 }] },
  "2026-10-10": { day: "2026-10-10", transaction_count: 2,
                  nodes: [{ address: "fx-a" }, { address: "fx-b" }, { address: "fx-c" }],
                  edges: [{ source: "fx-a", target: "fx-b", tx_count: 1 }, { source: "fx-b", target: "fx-a", tx_count: 1 },
                          { source: "fx-b", target: "fx-c", tx_count: 2 }] },
};

async function mockApi(page: Page, handler: (path: string, url: URL) => { status: number; body: unknown }) {
  await page.route(`${API}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    const { status, body } = handler(url.pathname, url);
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body),
                          headers: { "Access-Control-Allow-Origin": "*" } });
  });
}

test("day selector switches the graph (fixture days)", async ({ page }) => {
  await mockApi(page, (path, url) =>
    path === "/api/days" ? { status: 200, body: fxDays } : { status: 200, body: fxGraphs[url.searchParams.get("day") ?? "2026-10-11"] });
  await page.goto("/");
  await waitForGraph(page);
  expect(await graphInfo(page)).toMatchObject({ nodes: 2, edges: 1 });
  await page.getByTestId("day-select").selectOption("2026-10-10");
  await page.waitForFunction(() => window.__bitflowGraph?.edgeCount() === 3);
  expect(await graphInfo(page)).toMatchObject({ nodes: 3, edges: 3 }); // fx-a->fx-b and fx-b->fx-a stay separate
});

test("empty state when no day is ingested", async ({ page }) => {
  await mockApi(page, (path) => path === "/api/days" ? { status: 200, body: [] }
    : { status: 404, body: { detail: { code: "no_ingested_days", message: "No day has been ingested yet." } } });
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toContainText("No data yet");
});

test("failed request shows an error with retry, retry recovers", async ({ page }) => {
  let failGraph = true;
  await mockApi(page, (path) => {
    if (path === "/api/days") return { status: 200, body: fxDays };
    if (failGraph) return { status: 500, body: { detail: "Internal Server Error" } };
    return { status: 200, body: fxGraphs["2026-10-11"] };
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Could not load the graph");
  failGraph = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await waitForGraph(page);
  expect((await graphInfo(page)).nodes).toBe(2);
});

test("validation error (422 shape) is shown readably in a panel", async ({ page }) => {
  await mockApi(page, (path) => {
    if (path === "/api/days") return { status: 200, body: fxDays };
    if (path === "/api/graph") return { status: 200, body: fxGraphs["2026-10-11"] };
    return { status: 422, body: { detail: [{ loc: ["query", "day"], msg: "Input should be a valid date", type: "x" }] } };
  });
  await page.goto("/");
  await waitForGraph(page);
  const p = await page.evaluate(() => window.__bitflowGraph!.renderedNodePosition("fx-a"));
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  await page.mouse.click(box.x + p!.x, box.y + p!.y);
  await expect(page.getByRole("alert")).toContainText("day: Input should be a valid date");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("network failure on the day list shows retry", async ({ page }) => {
  await page.route(`${API}/api/days`, (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Could not load the list of days");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
