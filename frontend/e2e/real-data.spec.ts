import { expect, test } from "@playwright/test";

import { API, focusEdge, graphInfo, hubId, pointOf, SHOTS, waitForGraph } from "./helpers";

// Checks specific to the stored 2026-10-09 day (real data). Skipped if that day is not ingested.
const DAY = "2026-10-09";

function formatSats(sats: number): string {
  // Independent re-implementation for the check (BigInt, 8 decimals, thousands separators).
  const v = BigInt(sats);
  const whole = (v / 100000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(v % 100000000n).toString().padStart(8, "0")} BTC`;
}

test.beforeEach(async ({ request }) => {
  const days: { date: string }[] = await (await request.get(`${API}/api/days`)).json();
  test.skip(!days.some((d) => d.date === DAY), `${DAY} is not ingested`);
});

test("real 2026-10-09: counts, 70-transaction edge, hub totals, timing, smoothness", async ({ page, request }) => {
  const navStart = Date.now();
  await page.goto("/");
  await page.getByTestId("day-select").selectOption(DAY);
  await waitForGraph(page);
  const wall = Date.now() - navStart;
  const info = await graphInfo(page);
  const nav = await page.evaluate(() => performance.getEntriesByType("navigation")[0].toJSON());
  console.log(`REAL counts from Cytoscape: nodes=${info.nodes} edges=${info.edges}`);
  console.log(`REAL timing: graph rendered ${Math.round(info.renderedAt)} ms after navigation start ` +
              `(DOMContentLoaded ${Math.round(nav.domContentLoadedEventEnd)} ms, layout ${info.layoutMs} ms); wall ${wall} ms`);
  expect(info.nodes).toBe(342);
  expect(info.edges).toBe(843);

  // (b) the 70-transaction edge.
  const graph = await (await request.get(`${API}/api/graph?day=${DAY}`)).json();
  const big = graph.edges.reduce((a: any, b: any) => (b.tx_count > a.tx_count ? b : a));
  expect(big.tx_count).toBe(70);
  const ep = await focusEdge(page, `${big.source}->${big.target}`, /· 70 transactions$/);
  await page.mouse.click(ep.x, ep.y);
  await expect(page.getByTestId("edge-tx-heading")).toHaveText("70 transactions");
  await expect(page.getByTestId("edge-tx")).toHaveCount(70);
  const list = page.getByTestId("edge-tx-list");
  await list.locator("li").last().scrollIntoViewIfNeeded();
  await expect(list.locator("li").last()).toBeInViewport();
  console.log("REAL 70-tx edge panel rows:", await page.getByTestId("edge-tx").count());
  await page.screenshot({ path: `${SHOTS}/desktop-edge-panel-70.png` });

  // (c) hub totals vs API after formatting.
  await page.getByRole("button", { name: "Reset view" }).click();
  const hub = await hubId(page);
  const api = await (await request.get(`${API}/api/addresses/${hub}?day=${DAY}`)).json();
  const hp = await pointOf(page, "node", hub);
  await page.mouse.click(hp.x, hp.y);
  await expect(page.getByTestId("address-tx-count")).toHaveText(String(api.transaction_count));
  await expect(page.getByTestId("address-sent")).toHaveText(formatSats(api.spent_sat));
  await expect(page.getByTestId("address-received")).toHaveText(formatSats(api.received_sat));
  await expect(page.getByTestId("address-scope")).toHaveText(api.scope);
  console.log(`REAL hub ${hub}: tx=${api.transaction_count} sent=${formatSats(api.spent_sat)} received=${formatSats(api.received_sat)}`);

  // (d) smoothness: frames per second while wheel-zooming and dragging for ~2 s.
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  await page.evaluate(() => {
    (window as any).__frames = [];
    const tick = (t: number) => { (window as any).__frames.push(t); (window as any).__raf = requestAnimationFrame(tick); };
    (window as any).__raf = requestAnimationFrame(tick);
  });
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i < 5 ? -120 : 120); await page.waitForTimeout(60); }
  await page.mouse.down();
  for (let i = 0; i < 40; i++) { await page.mouse.move(cx + 6 * i, cy + 3 * i); await page.waitForTimeout(16); }
  await page.mouse.up();
  const fps = await page.evaluate(() => {
    cancelAnimationFrame((window as any).__raf);
    const f: number[] = (window as any).__frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    return { frames: f.length, seconds: (f[f.length - 1] - f[0]) / 1000, maxGapMs: Math.max(...gaps),
             fps: (f.length - 1) / ((f[f.length - 1] - f[0]) / 1000) };
  });
  console.log(`REAL interaction: ${fps.frames} frames in ${fps.seconds.toFixed(2)} s = ${fps.fps.toFixed(1)} fps, longest frame gap ${fps.maxGapMs.toFixed(0)} ms`);
});
