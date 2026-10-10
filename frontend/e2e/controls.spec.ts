import { apiJson, expect, ingestedDays, test } from "./fixtures";
import {
  allNodesInView, graphInfo, hubId, openCalendarAt, pickDate, pickerButton, pointOf, SHOTS, utcToday, waitForDays,
  waitForGraph,
} from "./helpers";

// Controls panel, calendar, range placeholders and wheel zoom. Runs against the real stack; every date and
// count is computed at test time (from /api/days, /api/graph or today's UTC date). Tests that need a
// rendered graph skip when nothing is ingested; the others also run in the E2E_MOCK_EMPTY_API mode.

const TARGET_STEP = 0.2; // the decided wheel zoom per notch

async function requireGraph(request: Parameters<typeof ingestedDays>[0]) {
  const days = await ingestedDays(request);
  test.skip(days.length === 0, "No day has been ingested yet; this check needs a rendered graph.");
  return days;
}

/** Graph (model) coordinates of the point shown in the middle of the canvas. */
async function viewCentre(page: import("@playwright/test").Page) {
  const box = await canvasBox(page);
  return page.evaluate(([w, h]) => {
    const g = window.__bitflowGraph!;
    const pan = g.pan();
    return { x: (w / 2 - pan.x) / g.zoom(), y: (h / 2 - pan.y) / g.zoom() };
  }, [box.width, box.height] as const);
}

async function canvasBox(page: import("@playwright/test").Page) {
  return (await page.getByTestId("graph-canvas").boundingBox())!;
}

test("wheel zoom: one notch changes zoom by ~20 %, centred on the mouse; buttons and reset still work", async ({ page, request }) => {
  await requireGraph(request);
  await page.goto("/");
  await waitForGraph(page);
  const box = await canvasBox(page);
  const hub = await hubId(page);
  const cursor = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.45 };
  await page.mouse.move(cursor.x, cursor.y);

  for (const deltaY of [-100, 100]) {
    const z0 = (await graphInfo(page)).zoom;
    const p0 = await pointOf(page, "node", hub);
    await page.mouse.wheel(0, deltaY);
    await expect.poll(async () => (await graphInfo(page)).zoom).not.toBe(z0);
    const z1 = (await graphInfo(page)).zoom;
    const p1 = await pointOf(page, "node", hub);
    const ratio = z1 / z0;
    console.log(`ZOOM deltaY=${deltaY}: ${z0.toFixed(4)} -> ${z1.toFixed(4)}, ratio ${ratio.toFixed(4)} (${((ratio - 1) * 100).toFixed(1)} %)`);
    const expected = deltaY < 0 ? 1 + TARGET_STEP : 1 / (1 + TARGET_STEP);
    expect(ratio).toBeGreaterThan(expected * 0.95);
    expect(ratio).toBeLessThan(expected * 1.05);
    // Centred on the mouse: a node's offset from the cursor scales by the zoom ratio.
    expect(Math.abs((p1.x - cursor.x) - (p0.x - cursor.x) * ratio)).toBeLessThan(2);
    expect(Math.abs((p1.y - cursor.y) - (p0.y - cursor.y) * ratio)).toBeLessThan(2);
  }

  const z = (await graphInfo(page)).zoom;
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect((await graphInfo(page)).zoom).toBeGreaterThan(z);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect((await graphInfo(page)).zoom).toBeLessThan(z);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  expect(await allNodesInView(page)).toBe(false);
  await page.getByRole("button", { name: "Reset view" }).click();
  expect(await allNodesInView(page)).toBe(true);
});

test("controls panel is on the left and the graph renders inside the remaining area", async ({ page, request }) => {
  const days = await requireGraph(request);
  const { body: graph } = await apiJson<{ nodes: unknown[]; edges: unknown[] }>(request, `/api/graph?day=${days[0].date}`);
  await page.goto("/");
  await waitForGraph(page);
  const controls = (await page.getByTestId("controls-panel").boundingBox())!;
  const canvas = await canvasBox(page);
  expect(controls.x).toBeLessThan(canvas.x);
  expect(controls.x + controls.width).toBeLessThanOrEqual(canvas.x + 1);
  expect(canvas.width).toBeGreaterThan(200);
  expect(await allNodesInView(page)).toBe(true);
  const info = await graphInfo(page);
  expect(info.nodes).toBe(graph.nodes.length);
  expect(info.edges).toBe(graph.edges.length);
  await expect(page.getByTestId("day-select")).toHaveCount(0); // the old header dropdown is gone
  await page.screenshot({ path: `${SHOTS}/controls-desktop.png` });
});

test("selecting an ingested day in the calendar shows its graph", async ({ page, request }) => {
  const days = await requireGraph(request);
  const target = days[days.length - 1].date; // oldest ingested day (the latest is already the default)
  const { body: graph } = await apiJson<{ nodes: unknown[] }>(request, `/api/graph?day=${target}`);
  await page.goto("/");
  await waitForGraph(page);
  const dialog = await openCalendarAt(page, target);
  await expect(dialog.locator(`button[data-date="${target}"]`)).toHaveClass(/marked/);
  await expect(dialog.locator(`button[data-date="${target}"]`)).toHaveAttribute("aria-label", /has data/);
  // The popover is fully inside the controls panel (not clipped by its scroll container).
  const pop = (await dialog.boundingBox())!;
  const panelBox = (await page.getByTestId("controls-panel").boundingBox())!;
  expect(pop.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(pop.x + pop.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  await page.screenshot({ path: `${SHOTS}/calendar-open.png` });
  await dialog.locator(`button[data-date="${target}"]`).click();
  await expect(pickerButton(page)).toHaveAttribute("data-value", target);
  await expect(page.getByTestId("summary-day")).toHaveText(target);
  await page.waitForFunction((n) => window.__bitflowGraph?.nodeCount() === n, graph.nodes.length);
});

test("a past date without ingested data shows 'No data available' and no graph", async ({ page, request }) => {
  const ingested = new Set((await ingestedDays(request)).map((d) => d.date));
  let date = utcToday(-1);
  for (let i = 2; ingested.has(date); i++) date = utcToday(-i);
  await page.goto("/");
  await expect(page.getByTestId("controls-panel")).toBeVisible();
  await pickDate(page, date);
  await expect(page.getByTestId("no-data")).toHaveText("No data available");
  await expect(page.getByTestId("graph-canvas")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0); // not an error
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  console.log(`NO-DATA date used: ${date}`);
  await page.screenshot({ path: `${SHOTS}/no-data.png` });
});

test("tomorrow (UTC) is disabled and cannot be selected by click, keyboard or typed year", async ({ page }) => {
  const today = utcToday();
  const tomorrow = utcToday(1);
  await page.goto("/");
  await waitForDays(page);
  const before = await pickerButton(page).getAttribute("data-value");
  const dialog = await openCalendarAt(page, today);
  const todayCell = dialog.locator(`button[data-date="${today}"]`);
  await expect(todayCell).toBeEnabled();

  if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
    const cell = dialog.locator(`button[data-date="${tomorrow}"]`);
    await expect(cell).toBeDisabled();
    await expect(cell).toHaveAttribute("aria-disabled", "true");
    await cell.click({ force: true });
    await expect(pickerButton(page)).toHaveAttribute("data-value", before ?? "");
  } else {
    // Tomorrow is in the next month, which the calendar does not navigate to.
    await expect(dialog.getByRole("button", { name: "Next month" })).toBeDisabled();
    await expect(dialog.locator(`button[data-date="${tomorrow}"]`)).toHaveCount(0);
  }

  // Keyboard: from today, ArrowRight must not move focus onto tomorrow; Enter then picks today, never tomorrow.
  await todayCell.focus();
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.date)).toBe(today);
  await page.keyboard.press("PageDown");
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.date)).toBe(today);

  // Typed year beyond the current one is clamped back.
  const year = dialog.getByLabel("Year", { exact: true });
  await year.fill(String(Number(today.slice(0, 4)) + 1));
  await year.press("Enter");
  await expect(year).toHaveValue(today.slice(0, 4));
  await expect(dialog.locator(`button[data-date="${tomorrow}"]:enabled`)).toHaveCount(0);

  await dialog.locator(`button[data-date="${today}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(pickerButton(page)).toHaveAttribute("data-value", today);
  expect(await pickerButton(page).getAttribute("data-value")).not.toBe(tomorrow);

  // The custom range fields follow the same rule.
  const from = await openCalendarAt(page, today, "range-from");
  await expect(from.locator(`button[data-date="${tomorrow}"]:enabled`)).toHaveCount(0);
});

test("range buttons and Apply show a temporary 'coming soon' bubble and change nothing", async ({ page, request }) => {
  const hasData = (await ingestedDays(request)).length > 0;
  await page.goto("/");
  await waitForDays(page);
  if (hasData) await waitForGraph(page);
  const dateBefore = await pickerButton(page).getAttribute("data-value");
  const nodesBefore = hasData ? (await graphInfo(page)).nodes : null;

  for (const name of ["Past week", "Past month", "Past year", "Apply"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const bubble = page.getByRole("status").filter({ hasText: "Date range selection coming soon" });
    await expect(bubble).toBeVisible();
    if (name === "Past week") await page.screenshot({ path: `${SHOTS}/coming-soon.png` });
    await expect(bubble).toBeHidden({ timeout: 5_000 }); // disappears by itself after ~3 s
    await expect(pickerButton(page)).toHaveAttribute("data-value", dateBefore ?? "");
    if (hasData) expect((await graphInfo(page)).nodes).toBe(nodesBefore);
  }

  // Dismissable before the timeout.
  await page.getByRole("button", { name: "Past month", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(page.getByTestId("coming-soon")).toHaveCount(0);
});

test("detail panels still open on the right with the controls panel present; the graph resizes", async ({ page, request }) => {
  await requireGraph(request);
  await page.goto("/");
  await waitForGraph(page);
  const before = await canvasBox(page);
  const centreBefore = await viewCentre(page);
  const hub = await hubId(page);
  const p = await pointOf(page, "node", hub);
  await page.mouse.click(p.x, p.y);
  const panel = page.getByTestId("side-panel");
  await expect(panel).toContainText(hub);
  const panelBox = (await panel.boundingBox())!;
  const during = await canvasBox(page);
  const controls = (await page.getByTestId("controls-panel").boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(during.x + during.width - 1); // right of the graph
  expect(controls.x + controls.width).toBeLessThanOrEqual(during.x + 1); // controls stay left
  expect(during.width).toBeLessThan(before.width); // graph area shrank
  // The graph point that was in the middle of the view is still in the middle after the resize.
  expect(Math.abs(centreBefore.x - (await viewCentre(page)).x)).toBeLessThan(1);
  expect(Math.abs(centreBefore.y - (await viewCentre(page)).y)).toBeLessThan(1);
  await page.screenshot({ path: `${SHOTS}/node-panel-with-controls.png` });

  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await canvasBox(page)).width).toBe(before.width);
});

test("narrow layout: controls stack above the graph", async ({ page, request }) => {
  const hasData = (await ingestedDays(request)).length > 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const controls = (await page.getByTestId("controls-panel").boundingBox())!;
  expect(controls.width).toBeGreaterThan(300);
  if (hasData) {
    await waitForGraph(page);
    const canvas = await canvasBox(page);
    expect(canvas.y).toBeGreaterThanOrEqual(controls.y + controls.height - 1);
  }
  await page.screenshot({ path: `${SHOTS}/narrow-layout.png`, fullPage: true });
});
