# BitFlow frontend

React + TypeScript (Vite) visualiser for one UTC day at a time. It talks only to the BitFlow backend API, at `VITE_API_BASE_URL`, which is baked in at build time. The graph library (Cytoscape.js) lives only in `src/components/GraphView.tsx`.

```bash
# from the repository root
docker compose up -d --build                                # frontend on 127.0.0.1:${FRONTEND_HOST_PORT:-3000}
docker compose --profile test run --rm --build frontend-test  # unit tests (Vitest)
docker compose --profile e2e run --rm frontend-e2e            # Playwright against the running stack
```

`CORS_ALLOW_ORIGINS` (backend) must include the frontend's origin. Playwright screenshots go to `screenshots/` (gitignored).

For local development without Docker: `npm ci`, `npm run dev`, `npm test`, `npm run typecheck`.
