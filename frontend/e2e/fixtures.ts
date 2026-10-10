import { test as base, type APIRequestContext } from "@playwright/test";

import { API } from "./helpers";

/**
 * E2E_MOCK_EMPTY_API=1 runs the whole suite as if no day were ingested: every browser call to the API and
 * every direct API call made through `apiJson` answers like an empty database. Used to check that no test
 * depends on what is stored in the real database.
 */
export const MOCK_EMPTY_API = process.env.E2E_MOCK_EMPTY_API === "1";

const EMPTY_404 = { detail: { code: "no_ingested_days", message: "No day has been ingested yet." } };

function emptyResponse(path: string): { status: number; body: unknown } {
  return path === "/api/days" ? { status: 200, body: [] } : { status: 404, body: EMPTY_404 };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    if (MOCK_EMPTY_API) {
      // Registered first, so routes added later by a test (states.spec.ts) take precedence.
      await page.route(`${API}/api/**`, async (route) => {
        const { status, body } = emptyResponse(new URL(route.request().url()).pathname);
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body),
                              headers: { "Access-Control-Allow-Origin": "*" } });
      });
    }
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** GET an API path directly (not through the page). Honors E2E_MOCK_EMPTY_API. */
export async function apiJson<T>(request: APIRequestContext, path: string): Promise<{ status: number; body: T }> {
  if (MOCK_EMPTY_API) return emptyResponse(new URL(path, API).pathname) as { status: number; body: T };
  const r = await request.get(`${API}${path}`);
  return { status: r.status(), body: (await r.json()) as T };
}

export async function ingestedDays(request: APIRequestContext): Promise<{ date: string }[]> {
  const { body } = await apiJson<{ date: string }[]>(request, "/api/days");
  return body;
}
