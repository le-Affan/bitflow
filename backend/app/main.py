from fastapi import FastAPI

app = FastAPI(title="BitFlow API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
