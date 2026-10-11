import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { API, graphInfo, openCalendarAt, pickDate, pickerButton, waitForGraph } from "./helpers";

// UI states with the API fully mocked by route interception. Never touches the real database.
// TEST FIXTURES: every date, address and count below is synthetic, not real chain data. The dates are a
// fixed past month so they stay selectable (the calendar disables days after today, UTC).
const fxDays = [
  { date: "2025-03-15", transaction_count: 1, ingested_at: "2025-03-16T01:10:00Z" },
  { date: "2025-03-14", transaction_count: 2, ingested_at: "2025-03-15T01:10:00Z" },
];
const fxGraphs: Record<string, unknown> = {
  "2025-03-15": { day: "2025-03-15", transaction_count: 1, nodes: [{ address: "fx-a" }, { address: "fx-b" }],
                  edges: [{ source: "fx-a", target: "fx-b", tx_count: 1 }] },
  "2025-03-14": { day: "2025-03-14", transaction_count: 2,
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
    path === "/api/days" ? { status: 200, body: fxDays } : { status: 200, body: fxGraphs[url.searchParams.get("day") ?? "2025-03-15"] });
  await page.goto("/");
  await waitForGraph(page);
  expect(await graphInfo(page)).toMatchObject({ nodes: 2, edges: 1 });
  await pickDate(page, "2025-03-14");
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
    return { status: 200, body: fxGraphs["2025-03-15"] };
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
    if (path === "/api/graph") return { status: 200, body: fxGraphs["2025-03-15"] };
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

// Day states. TEST FIXTURES: the days, counts and the status payload are synthetic; 2008-06-01 is any day before
// the Bitcoin genesis day (2009-01-03, a protocol fact).
const fxEmptyDay = "2025-03-10";
const fxEmptyGraph = { day: fxEmptyDay, transaction_count: 0, nodes: [], edges: [], status: "no_eligible_transactions" };

function dayStatesApi(path: string, url: URL): { status: number; body: unknown } {
  if (path === "/api/days") return { status: 200, body: fxDays };
  const day = url.searchParams.get("day") ?? "2025-03-15";
  if (day === fxEmptyDay) return { status: 200, body: fxEmptyGraph };
  if (fxGraphs[day]) return { status: 200, body: fxGraphs[day] };
  return { status: 404, body: { detail: { code: "day_not_ingested", message: `Day ${day} has not been ingested.` } } };
}

async function expectNoErrorAndNoGraph(page: Page) {
  await expect(page.getByTestId("graph-canvas")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
}

test("checked day with 0 eligible transactions shows an empty graph message, not an error", async ({ page }) => {
  await mockApi(page, dayStatesApi);
  await page.goto("/");
  await waitForGraph(page);
  await pickDate(page, fxEmptyDay); // not in /api/days, still selectable and asked from the API
  await expect(page.getByTestId("empty-day")).toContainText("0 eligible transactions on this day");
  await expect(page.getByTestId("summary-day")).toHaveText(fxEmptyDay);
  await expect(page.getByTestId("graph-summary")).toContainText("0 transactions");
  await expect(page.getByTestId("no-data")).toHaveCount(0);
  await expectNoErrorAndNoGraph(page);
});

test("a day before the first Bitcoin block shows that message without asking the API", async ({ page }) => {
  const graphDays: string[] = [];
  await mockApi(page, (path, url) => {
    if (path === "/api/graph") graphDays.push(url.searchParams.get("day") ?? "");
    return dayStatesApi(path, url);
  });
  await page.goto("/");
  await waitForGraph(page);
  await pickDate(page, "2008-06-01");
  await expect(page.getByTestId("before-bitcoin")).toContainText("Before the first Bitcoin block");
  await expectNoErrorAndNoGraph(page);
  expect(graphDays).not.toContain("2008-06-01");
});

test("a day never loaded shows 'No data available'", async ({ page }) => {
  await mockApi(page, dayStatesApi);
  await page.goto("/");
  await waitForGraph(page);
  await pickDate(page, "2025-03-12");
  await expect(page.getByTestId("no-data")).toHaveText("No data available");
  await expectNoErrorAndNoGraph(page);
});

test("switching days quickly never shows the outdated graph", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const aborted: string[] = [];
  page.on("requestfailed", (r) => aborted.push(new URL(r.url()).searchParams.get("day") ?? ""));
  await page.route(`${API}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("day") === "2025-03-14") await held; // slow day: answers only after the switch
    const { status, body } = dayStatesApi(url.pathname, url);
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body),
                          headers: { "Access-Control-Allow-Origin": "*" } }).catch(() => {}); // request may be aborted
  });
  await page.goto("/");
  await waitForGraph(page);
  await pickDate(page, "2025-03-14"); // slow request starts
  await pickDate(page, "2025-03-15"); // switch before it answers
  await page.waitForFunction(() => window.__bitflowGraph?.edgeCount() === 1);
  release(); // the outdated answer arrives now
  await page.waitForTimeout(500);
  await expect(page.getByTestId("summary-day")).toHaveText("2025-03-15");
  expect(await graphInfo(page)).toMatchObject({ nodes: 2, edges: 1 });
  expect(aborted).toContain("2025-03-14"); // the outdated request was cancelled, not only ignored
});

// Ranges. TEST FIXTURES: synthetic days and graphs (fxDays above: latest stored day 2025-03-15).
const fxRangeGraph = (start: string, end: string) => ({
  start, end, transaction_count: 2, nodes: [{ address: "fx-r1" }, { address: "fx-r2" }, { address: "fx-r3" }],
  edges: [{ source: "fx-r1", target: "fx-r2", tx_count: 1 }, { source: "fx-r2", target: "fx-r3", tx_count: 1 }],
});

function rangeApi(path: string, url: URL): { status: number; body: unknown } {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (path === "/api/graph" && start && end) {
    if (start === "2025-04-01") return { status: 404, body: { detail: { code: "day_not_ingested", message: "No day from 2025-04-01 to 2025-04-02 has been ingested." } } };
    if (start === "2025-03-01") return { status: 200, body: { start, end, transaction_count: 0, nodes: [], edges: [], status: "no_eligible_transactions" } };
    return { status: 200, body: fxRangeGraph(start, end) };
  }
  return dayStatesApi(path, url);
}

test("preset ranges end on the latest stored day; the day picker switches back", async ({ page }) => {
  const asked: string[] = [];
  await mockApi(page, (path, url) => {
    if (path === "/api/graph") asked.push(url.search);
    return rangeApi(path, url);
  });
  await page.goto("/");
  await waitForGraph(page);
  for (const [name, start] of [["Past week", "2025-03-09"], ["Past month", "2025-02-14"], ["Past year", "2024-03-16"]]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByTestId("summary-day")).toHaveText(`${start} to 2025-03-15`);
    await page.waitForFunction(() => window.__bitflowGraph?.nodeCount() === 3);
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(asked.at(-1)).toBe(`?start=${start}&end=2025-03-15`);
  }
  await expect(page.getByTestId("graph-summary")).toContainText("2 transactions");
  await pickDate(page, "2025-03-14");
  await expect(page.getByTestId("summary-day")).toHaveText("2025-03-14");
  await page.waitForFunction(() => window.__bitflowGraph?.edgeCount() === 3);
});

test("custom range: To waits for From and never goes before it; pre-2009 start clamped; empty and no-data ranges", async ({ page }) => {
  const asked: string[] = [];
  await mockApi(page, (path, url) => {
    if (path === "/api/graph") asked.push(url.search);
    return rangeApi(path, url);
  });
  await page.goto("/");
  await waitForGraph(page);
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  const toButton = pickerButton(page, "range-to");

  await expect(toButton).toBeDisabled();
  await expect(toButton).toHaveText(/Select a date/);
  await expect(apply).toBeDisabled();

  await pickDate(page, "2025-03-10", "range-from");
  await expect(toButton).toBeEnabled();
  await expect(apply).toBeDisabled();
  const dialog = await openCalendarAt(page, "2025-03-10", "range-to");
  await expect(dialog.locator('button[data-date="2025-03-09"]')).toBeDisabled(); // before From
  await expect(dialog.locator('button[data-date="2025-03-10"]')).toBeEnabled();
  await dialog.locator('button[data-date="2025-03-12"]').click();
  await expect(apply).toBeEnabled();

  // From moved after To: To is cleared, and Apply stays disabled until a new To is picked.
  await pickDate(page, "2025-03-20", "range-from");
  await expect(toButton).toHaveAttribute("data-value", "");
  await expect(apply).toBeDisabled();

  await pickDate(page, "2008-06-01", "range-from");
  await pickDate(page, "2025-03-05", "range-to");
  await apply.click();
  await expect(page.getByTestId("summary-day")).toHaveText("2009-01-03 to 2025-03-05");
  await expect(pickerButton(page, "range-from")).toHaveAttribute("data-value", "2009-01-03");
  expect(asked.at(-1)).toBe("?start=2009-01-03&end=2025-03-05");

  await pickDate(page, "2025-03-01", "range-from");
  await pickDate(page, "2025-03-02", "range-to");
  await apply.click();
  await expect(page.getByTestId("empty-day")).toContainText("0 eligible transactions in this range");

  await pickDate(page, "2025-04-01", "range-from");
  await pickDate(page, "2025-04-02", "range-to");
  await apply.click();
  await expect(page.getByTestId("no-data")).toHaveText("No data available");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
