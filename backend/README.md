# BitFlow backend

FastAPI service. Currently exposes only `GET /health`.

## Run

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

## Test

```bash
pytest
```

Run both commands from this `backend/` directory.
