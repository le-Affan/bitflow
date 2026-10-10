"""Composition root of the HTTP app: wires the PostgreSQL repository into the read-only API."""
from functools import lru_cache
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router
from app.config import cors_allow_origins, database_url
from app.repository import DayRepository


@lru_cache(maxsize=1)
def _postgres_repository() -> DayRepository:
    from app.repository.postgres import PostgresDayRepository

    return PostgresDayRepository.from_url(database_url())


def create_app(repository_provider: Callable[[], DayRepository] | None = None) -> FastAPI:
    app = FastAPI(title="BitFlow API")
    # Resolved lazily per request, so importing the app never connects to the database.
    app.state.repository_provider = repository_provider or _postgres_repository

    # Compress JSON responses for clients that accept gzip (the graph of a large day is ~1 MB uncompressed).
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    origins = cors_allow_origins()
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_headers=["*"])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)
    return app


app = create_app()
