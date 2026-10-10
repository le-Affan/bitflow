import { apiJson, expect, ingestedDays, test } from "./fixtures";
import { graphInfo, openEdge, pointOf, SHOTS, waitForGraph } from "./helpers";

// Checks the rendered page against whatever the real API serves for the latest ingested day.
// No data values are hardcoded: every expectation is derived from API responses at test time.

interface GraphEdge { source: string; target: string; tx_count: number }
interface Graph { day: string; nodes: { address: string }[]; edges: GraphEdge[] }

function formatBtcIndependent(sats: number): string {
  // Independent re-implementation for the check (BigInt, 8 decimals, thousands separators).
  const v = BigInt(sats);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = (abs / 100000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${whole}.${(abs % 100000000n).toString().padStart(8, "0")} BTC`;
}

const plural = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;
// Independent of src/lib/shorten.ts: first 6 + "…" + last 4.
const short = (a: string) => (a.length <= 11 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);

test("latest ingested day: rendered graph and panels match the API", async ({ page, request }) => {
  const days = await ingestedDays(request);
  test.skip(days.length === 0, "No day has been ingested yet, so there is no real data to check.");
  const day = days[0].date; // /api/days is newest first

  const { body: graph } = await apiJson<Graph>(request, `/api/graph?day=${day}`);
  const expectedNodes = graph.nodes.length;
  const expectedEdges = graph.edges.length;
  // Consistency of the API data itself: nodes are exactly the addresses that appear in edges.
  const endpoints = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  expect(endpoints.size).toBe(expectedNodes);

  // Most-connected node and the edge with the most transactions, from the API data (ties: alphabetical).
  const degree = new Map<string, number>();
  for (const e of graph.edges) for (const a of [e.source, e.target]) degree.set(a, (degree.get(a) ?? 0) + 1);
  const [hub, hubDegree] = [...degree.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const big = [...graph.edges].sort((a, b) => b.tx_count - a.tx_count || a.source.localeCompare(b.source)
                                              || a.target.localeCompare(b.target))[0];

  // Page load to rendered graph (the app defaults to the latest day).
  const navStart = Date.now();
  await page.goto("/");
  await waitForGraph(page);
  const wall = Date.now() - navStart;
  await expect(page.getByTestId("day-select")).toHaveValue(day);
  const info = await graphInfo(page);
  console.log(`DAY ${day}: API nodes=${expectedNodes} edges=${expectedEdges}; rendered nodes=${info.nodes} edges=${info.edges}`);
  console.log(`TIMING graph rendered ${Math.round(info.renderedAt)} ms after navigation start (layout ${info.layoutMs} ms, wall ${wall} ms)`);
  expect(info.nodes).toBe(expectedNodes);
  expect(info.edges).toBe(expectedEdges);
  expect(info.renderedAt).toBeLessThan(60_000); // loose sanity bound only

  // Edge with the most transactions: the panel lists exactly what /api/edges reports.
  const { body: edgeDetail } = await apiJson<{ transactions: unknown[] }>(
    request, `/api/edges?day=${day}&source=${encodeURIComponent(big.source)}&target=${encodeURIComponent(big.target)}`);
  expect(edgeDetail.transactions.length).toBe(big.tx_count);
  const how = await openEdge(page, `${big.source}->${big.target}`,
                             `${short(big.source)} → ${short(big.target)} · ${plural(big.tx_count)}`);
  await expect(page.getByTestId("side-panel")).toContainText(short(big.source));
  await expect(page.getByTestId("side-panel")).toContainText(short(big.target));
  await expect(page.getByTestId("edge-tx-heading")).toHaveText(plural(edgeDetail.transactions.length));
  await expect(page.getByTestId("edge-tx")).toHaveCount(edgeDetail.transactions.length);
  const last = page.getByTestId("edge-tx-list").locator("li").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  console.log(`EDGE with most transactions: ${big.tx_count} in API, ${await page.getByTestId("edge-tx").count()} rows in panel (opened by ${how})`);
  await page.screenshot({ path: `${SHOTS}/desktop-edge-panel-largest.png` });

  // Most-connected node: panel totals equal /api/addresses after independent formatting.
  await page.getByRole("button", { name: "Reset view" }).click();
  const { body: addr } = await apiJson<{ transaction_count: number; spent_sat: number; received_sat: number; scope: string }>(
    request, `/api/addresses/${encodeURIComponent(hub)}?day=${day}`);
  const hp = await pointOf(page, "node", hub);
  await page.mouse.click(hp.x, hp.y);
  await expect(page.getByTestId("side-panel")).toContainText(hub);
  await expect(page.getByTestId("address-tx-count")).toHaveText(String(addr.transaction_count));
  await expect(page.getByTestId("address-sent")).toHaveText(formatBtcIndependent(addr.spent_sat));
  await expect(page.getByTestId("address-received")).toHaveText(formatBtcIndependent(addr.received_sat));
  await expect(page.getByTestId("address-scope")).toHaveText(addr.scope);
  console.log(`HUB degree ${hubDegree}: tx=${addr.transaction_count} sent=${formatBtcIndependent(addr.spent_sat)} ` +
              `received=${formatBtcIndependent(addr.received_sat)}`);

  // Smoothness: frames per second while wheel-zooming and dragging for ~2 s. Reported, loosely bounded.
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    w.__frames = [];
    const tick = (t: number) => { w.__frames.push(t); w.__raf = requestAnimationFrame(tick); };
    w.__raf = requestAnimationFrame(tick);
  });
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i < 5 ? -120 : 120); await page.waitForTimeout(60); }
  await page.mouse.down();
  for (let i = 0; i < 40; i++) { await page.mouse.move(cx + 6 * i, cy + 3 * i); await page.waitForTimeout(16); }
  await page.mouse.up();
  const fps = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    cancelAnimationFrame(w.__raf);
    const f = w.__frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    return { frames: f.length, seconds: (f[f.length - 1] - f[0]) / 1000, maxGapMs: Math.max(...gaps),
             fps: (f.length - 1) / ((f[f.length - 1] - f[0]) / 1000) };
  });
  console.log(`INTERACTION ${fps.frames} frames in ${fps.seconds.toFixed(2)} s = ${fps.fps.toFixed(1)} fps, ` +
              `longest frame gap ${fps.maxGapMs.toFixed(0)} ms`);
  expect(fps.fps).toBeGreaterThan(5); // loose sanity bound only
});
