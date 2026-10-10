import { expect, test } from "@playwright/test";

import { allNodesInView, graphInfo, hubId, pointOf, SHOTS, waitForGraph } from "./helpers";

// Smoke test against the real running stack and whatever days are ingested.
test("graph, node panel, edge panel, transaction details, zoom, day selector", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  const info = await graphInfo(page);
  expect(info.nodes).toBeGreaterThan(0);
  expect(info.edges).toBeGreaterThan(0);
  await expect(page.getByTestId("rendered-nodes")).toHaveText(String(info.nodes));
  await expect(page.getByTestId("rendered-edges")).toHaveText(String(info.edges));

  // Node: click the hub.
  const hub = await hubId(page);
  const hp = await pointOf(page, "node", hub);
  await page.mouse.move(hp.x, hp.y);
  await expect(page.getByRole("tooltip")).toContainText(hub.slice(0, 6));
  await page.mouse.click(hp.x, hp.y);
  const panel = page.getByTestId("side-panel");
  await expect(panel).toContainText(hub);
  await expect(page.getByTestId("address-tx-count")).not.toBeEmpty();
  await expect(page.getByTestId("address-scope")).toContainText("not the address's full history");
  await page.screenshot({ path: `${SHOTS}/desktop-node-panel.png` });

  // Edge: click the edge with the most transactions (largest list), via its midpoint.
  const edge = await page.evaluate(() => {
    const g = window.__bitflowGraph!;
    return g.edgeIds()[0];
  });
  const ep = await pointOf(page, "edge", edge);
  await page.mouse.click(ep.x, ep.y);
  await expect(page.getByTestId("edge-tx-list")).toBeVisible();
  const rows = page.getByTestId("edge-tx");
  expect(await rows.count()).toBeGreaterThan(0);

  // Transaction details.
  await rows.first().click();
  await expect(page.getByTestId("tx-details")).toBeVisible();
  await expect(page.getByTestId("tx-height")).toHaveText(/^\d+$/);
  await expect(page.getByText(/^Inputs \(\d+\)$/)).toBeVisible();
  await expect(page.getByText(/^Outputs \(\d+\)$/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop-transaction.png` });

  // Zoom with buttons and wheel, pan, reset.
  const z0 = (await graphInfo(page)).zoom;
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect((await graphInfo(page)).zoom).toBeGreaterThan(z0);
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.mouse.wheel(0, 400);
  const pan0 = await page.evaluate(() => window.__bitflowGraph!.pan());
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + box.height - 120, { steps: 10 });
  await page.mouse.up();
  const pan1 = await page.evaluate(() => window.__bitflowGraph!.pan());
  expect(pan1.x).not.toBe(pan0.x);
  expect(await allNodesInView(page)).toBe(false); // zoomed in: part of the graph is off-screen
  await page.getByRole("button", { name: "Reset view" }).click();
  expect(await allNodesInView(page)).toBe(true);

  // Day selector: pick each listed day; the graph re-renders for it.
  const select = page.getByTestId("day-select");
  const values = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  for (const v of values) {
    await select.selectOption(v);
    await expect(select).toHaveValue(v);
    await waitForGraph(page);
  }
  await page.screenshot({ path: `${SHOTS}/desktop-graph.png` });
});

test("narrow viewport layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForGraph(page);
  await page.screenshot({ path: `${SHOTS}/narrow-graph.png` });
  const hub = await hubId(page);
  const p = await pointOf(page, "node", hub);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("address-facts")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/narrow-node-panel.png` });
});
