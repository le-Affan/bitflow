import os


def database_url() -> str:
    """SQLAlchemy URL of the BitFlow database, taken from the environment."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url
