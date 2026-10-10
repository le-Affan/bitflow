# Build context: backend/
FROM python:3.14-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .

RUN useradd --create-home --uid 1000 bitflow
USER bitflow

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Test image: adds test dependencies. Source and tests are bind-mounted by the backend-test service.
FROM base AS test
USER root
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
USER bitflow
CMD ["pytest", "-v"]
