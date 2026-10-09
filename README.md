# BitFlow

Bitcoin transaction visualizer. BitFlow keeps its own growing dataset of Bitcoin blockchain activity, ingested once per day from a public Bitcoin API, and renders the top 100 transactions for a chosen date range as an interactive graph: addresses are nodes, address-to-address transfers are directed edges.

**Status: scaffolding.** Only the project skeleton and a backend health check exist. No features are implemented yet.

- Product requirements: [`docs/BitFlow_PRD.md`](docs/BitFlow_PRD.md)
- Backend: [`backend/`](backend/README.md) (FastAPI)
- Frontend: `frontend/` (React + TypeScript, not started)
- Docker: `docker/` (not started)
