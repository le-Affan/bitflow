"""Sequential, polite HTTP client: pause between requests, retries with exponential backoff."""
import logging
import time
from typing import Any, Callable

import httpx2

from app.ingestion.source import RateLimitedError, SourceError, SourceStats

log = logging.getLogger("bitflow.sources.blockchain_info")

RATE_LIMIT_STATUSES = {429, 430}


class HttpClient:
    def __init__(
        self,
        base_url: str,
        *,
        pause_s: float = 1.0,
        max_retries: int = 5,
        backoff_base_s: float = 2.0,
        max_consecutive_rate_limits: int = 2,
        connect_timeout_s: float = 10.0,
        read_timeout_s: float = 120.0,
        user_agent: str = "BitFlow/0.1",
        transport: httpx2.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = httpx2.Client(
            base_url=base_url,
            timeout=httpx2.Timeout(connect=connect_timeout_s, read=read_timeout_s, write=30.0, pool=30.0),
            headers={"User-Agent": user_agent},
            transport=transport,
        )
        self._pause_s = pause_s
        self._max_retries = max_retries
        self._backoff_base_s = backoff_base_s
        self._max_consecutive_rate_limits = max_consecutive_rate_limits
        self._sleep = sleep
        self._clock = clock
        self._last_request_at: float | None = None
        self.stats = SourceStats()

    def _wait_for_pause(self) -> None:
        if self._last_request_at is not None:
            remaining = self._pause_s - (self._clock() - self._last_request_at)
            if remaining > 0:
                self._sleep(remaining)

    def get_json(self, path: str) -> Any:
        consecutive_rate_limits = 0
        for attempt in range(self._max_retries + 1):
            if attempt:
                self.stats.retries += 1
            self._wait_for_pause()
            self.stats.requests += 1
            self._last_request_at = self._clock()
            try:
                response = self._client.get(path)
            except httpx2.TransportError as exc:  # includes connect/read timeouts and connection errors
                reason = f"{type(exc).__name__}: {exc}"
                retry_after = None
            else:
                self.stats.bytes += len(response.content)
                if response.status_code == 200:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise SourceError(f"GET {path}: invalid JSON") from exc
                reason = f"HTTP {response.status_code}"
                retry_after = _retry_after(response)
                if response.status_code in RATE_LIMIT_STATUSES:
                    consecutive_rate_limits += 1
                    if consecutive_rate_limits >= self._max_consecutive_rate_limits:
                        raise RateLimitedError(
                            f"GET {path}: {reason} {consecutive_rate_limits} times in a row; stopping"
                        )
                elif response.status_code < 500:
                    raise SourceError(f"GET {path}: {reason}")
                else:
                    consecutive_rate_limits = 0
            if attempt == self._max_retries:
                raise SourceError(f"GET {path}: {reason}; gave up after {self._max_retries} retries")
            delay = max(self._backoff_base_s * 2**attempt, retry_after or 0)
            log.warning("GET %s: %s; retry %d/%d in %.1fs", path, reason, attempt + 1, self._max_retries, delay)
            self._sleep(delay)
        raise AssertionError("unreachable")

    def close(self) -> None:
        self._client.close()


def _retry_after(response: httpx2.Response) -> float | None:
    value = response.headers.get("retry-after")
    try:
        return float(value) if value else None
    except ValueError:
        return None
