# BitFlow frontend

React + TypeScript (Vite) visualiser for one UTC day at a time. It talks only to the BitFlow backend API, at `VITE_API_BASE_URL`, which is baked in at build time. The graph library (Cytoscape.js) lives only in `src/components/GraphView.tsx`.

```bash
# from the repository root
docker compose up -d --build                                # frontend on 127.0.0.1:${FRONTEND_HOST_PORT:-3000}
docker compose --profile test run --rm --build frontend-test  # unit tests (Vitest), under 3 time zones
docker compose --profile e2e run --rm --build frontend-e2e    # Playwright against the running backend
E2E_MOCK_EMPTY_API=1 docker compose --profile e2e run --rm frontend-e2e   # same suite, API mocked as "nothing ingested"
```

The end-to-end tests run against a separate build, `frontend-e2e-app` (127.0.0.1:${FRONTEND_E2E_HOST_PORT:-3100}). It is the same Dockerfile target built with `VITE_E2E_INSPECTOR=true`, which attaches the read-only test inspector `window.__bitflowGraph`. The production `frontend` image is built without the flag and does not contain the inspector. `CORS_ALLOW_ORIGINS` must also list the e2e origin. The tests assert no stored data values: expectations come from the API at test time, and tests needing real data skip when nothing is ingested.

`CORS_ALLOW_ORIGINS` (backend) must include the frontend's origin (and the e2e origin, see below). Playwright screenshots go to `screenshots/` (gitignored).

For local development without Docker: `npm ci`, `npm run dev`, `npm test` (or `npm run test:tz` for the three time zones), `npm run typecheck`.

All days are UTC calendar days handled as `YYYY-MM-DD` strings (`src/lib/dates.ts`); never convert them through a local-time `Date`. The calendar disables days after today (UTC).
