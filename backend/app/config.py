import os


def database_url() -> str:
    """SQLAlchemy URL of the BitFlow database, taken from the environment."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value else default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


def ingestion_settings() -> dict:
    """Ingestion tuning from the environment. Defaults follow docs/BitFlow_PRD.md (MVP scope update)."""
    return {
        "pause_s": _env_float("INGEST_REQUEST_PAUSE_SECONDS", 1.0),
        "max_retries": _env_int("INGEST_MAX_RETRIES", 5),
        "backoff_base_s": _env_float("INGEST_BACKOFF_BASE_SECONDS", 2.0),
        "connect_timeout_s": _env_float("INGEST_CONNECT_TIMEOUT_SECONDS", 10.0),
        "read_timeout_s": _env_float("INGEST_READ_TIMEOUT_SECONDS", 120.0),
        "margin_blocks": _env_int("INGEST_MARGIN_BLOCKS", 3),
    }


def cors_allow_origins() -> list[str]:
    """Origins allowed by CORS, from CORS_ALLOW_ORIGINS (comma-separated). Empty = CORS disabled."""
    return [o.strip() for o in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
