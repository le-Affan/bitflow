import { expect, type Page } from "@playwright/test";

export const API = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";
export const SHOTS = "screenshots";

export async function waitForGraph(page: Page) {
  await page.waitForFunction(() => !!window.__bitflowGraph && window.__bitflowGraph.nodeCount() > 0);
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

/** Zooms in around an edge's midpoint until its tooltip confirms it is under the cursor, then returns that point. */
export async function focusEdge(page: Page, id: string, expectedTooltip: RegExp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const p = await pointOf(page, "edge", id);
    await page.mouse.move(p.x, p.y);
    const tip = page.getByRole("tooltip");
    if ((await tip.count()) && expectedTooltip.test((await tip.textContent()) ?? "")) return p;
    await page.mouse.wheel(0, -300); // zoom in around the cursor
    await page.waitForTimeout(100);
  }
  throw new Error(`could not isolate edge ${id} under the cursor`);
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
