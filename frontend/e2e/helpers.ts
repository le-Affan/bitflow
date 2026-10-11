import { expect, type Page } from "@playwright/test";

export const API = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";
export const SHOTS = "screenshots";

export async function waitForGraph(page: Page) {
  await page.waitForFunction(() => !!window.__bitflowGraph && window.__bitflowGraph.nodeCount() > 0);
}

/** Waits until no zoom/pan animation runs and no wheel zoom step is pending (signal from the app). */
export async function waitForViewportIdle(page: Page) {
  await page.waitForFunction(() => window.__bitflowGraph?.viewportIdle() === true);
}

export async function graphInfo(page: Page) {
  return page.evaluate(() => {
    const g = window.__bitflowGraph!;
    return { nodes: g.nodeCount(), edges: g.edgeCount(), zoom: g.zoom(), renderedAt: g.renderedAt, layoutMs: g.layoutMs };
  });
}

/** Page coordinates of a node or edge midpoint on the canvas. */
export async function pointOf(page: Page, kind: "node" | "edge", id: string) {
  const box = await page.getByTestId("graph-canvas").boundingBox();
  const p = await page.evaluate(
    ([k, i]) => (k === "node" ? window.__bitflowGraph!.renderedNodePosition(i) : window.__bitflowGraph!.renderedEdgeMidpoint(i)),
    [kind, id] as const,
  );
  expect(box && p).toBeTruthy();
  return { x: box!.x + p!.x, y: box!.y + p!.y };
}

export async function hubId(page: Page) {
  return page.evaluate(() => {
    const g = window.__bitflowGraph!;
    return g.nodeIds().reduce((best, id) => (g.degree(id) > g.degree(best) ? id : best));
  });
}

/**
 * Finds a point on the edge where hovering shows exactly `expectedTooltip`, trying several points along the
 * curve and zooming in around the edge between attempts (other nodes or edges may cover any single point).
 */
export async function focusEdge(page: Page, id: string, expectedTooltip: string): Promise<{ x: number; y: number } | null> {
  const ts = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
  const seen = new Set<string>();
  for (let zoomStep = 0; zoomStep < 6; zoomStep++) {
    const box = (await page.getByTestId("graph-canvas").boundingBox())!;
    for (const t of ts) {
      const p = await page.evaluate(([i, tt]) => window.__bitflowGraph!.renderedEdgePoint(i, tt), [id, t] as const);
      if (!p || p.x < 0 || p.y < 0 || p.x > box.width || p.y > box.height) continue;
      await page.mouse.move(box.x + p.x, box.y + p.y);
      await page.waitForTimeout(50); // let the hover event and tooltip render settle
      const tip = page.getByRole("tooltip");
      const text = (await tip.count()) ? await tip.textContent() : null;
      if (text === expectedTooltip) return { x: box.x + p.x, y: box.y + p.y };
      seen.add(`${zoomStep}/${t}: ${text}`);
    }
    const mid = await pointOf(page, "edge", id);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, -300); // zoom in around the edge
    await page.waitForTimeout(100);
  }
  console.log(`focusEdge: no point of ${id} is the top-most element; tooltips seen: ${[...seen].slice(0, 4).join(" | ")}`);
  return null;
}

export async function allNodesInView(page: Page) {
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  return page.evaluate(([w, h]) => {
    const g = window.__bitflowGraph!;
    return g.nodeIds().every((id) => {
      const p = g.renderedNodePosition(id)!;
      return p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
    });
  }, [box.width, box.height] as const);
}

/** Opens an edge's panel: a real mouse click if the edge can be isolated, otherwise the inspector's tap. */
export async function openEdge(page: Page, id: string, expectedTooltip: string): Promise<"click" | "inspector-tap"> {
  const p = await focusEdge(page, id, expectedTooltip);
  if (p) {
    await page.mouse.click(p.x, p.y);
    return "click";
  }
  const ok = await page.evaluate((i) => window.__bitflowGraph!.tap(i), id);
  if (!ok) throw new Error(`edge ${id} is not rendered`);
  return "inspector-tap";
}

/** Today's date in UTC as YYYY-MM-DD, computed independently of the app's date helpers. */
export function utcToday(offsetDays = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
}

export function pickerButton(page: Page, testId = "day-picker") {
  return page.getByTestId(testId).locator(".date-picker-button");
}

/** Opens the calendar of a date picker and navigates to the month of `ymd` (via the year field and month select). */
export async function openCalendarAt(page: Page, ymd: string, testId = "day-picker") {
  const root = page.getByTestId(testId);
  if ((await root.getByRole("dialog").count()) === 0) await pickerButton(page, testId).click();
  const dialog = root.getByRole("dialog");
  const year = dialog.getByLabel("Year", { exact: true });
  await year.fill(String(Number(ymd.slice(0, 4))));
  await year.press("Enter");
  await dialog.getByLabel("Month", { exact: true }).selectOption(String(Number(ymd.slice(5, 7))));
  return dialog;
}

/** Selects a date in a date picker by clicking its day cell. */
export async function pickDate(page: Page, ymd: string, testId = "day-picker") {
  const dialog = await openCalendarAt(page, ymd, testId);
  await dialog.locator(`button[data-date="${ymd}"]`).click();
  await expect(pickerButton(page, testId)).toHaveAttribute("data-value", ymd);
}

/** Waits until the controls panel has finished loading the list of ingested days (the default day is then set). */
export async function waitForDays(page: Page) {
  await expect(page.getByTestId("controls-panel")).not.toContainText("Loading ingested days");
}
