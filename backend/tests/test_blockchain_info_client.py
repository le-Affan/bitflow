"""HTTP client behaviour with a mocked transport. No real network."""
import httpx2
import pytest

from app.ingestion.source import RateLimitedError, SourceError
from app.sources.blockchain_info.client import HttpClient


def make(responses, **kw):
    calls, sleeps = [], []
    seq = iter(responses)

    def handler(request):
        calls.append(str(request.url))
        r = next(seq)
        if isinstance(r, Exception):
            raise r
        return r

    clock = iter(range(0, 10_000))
    client = HttpClient("https://example.test", transport=httpx2.MockTransport(handler),
                        sleep=sleeps.append, clock=lambda: next(clock), **kw)
    return client, calls, sleeps


def ok(body="[]"):
    return httpx2.Response(200, text=body)


def test_retries_5xx_then_succeeds_with_exponential_backoff():
    client, calls, sleeps = make([httpx2.Response(503), httpx2.Response(500), ok("[1]")], backoff_base_s=2, pause_s=0)
    assert client.get_json("/x") == [1]
    assert len(calls) == 3 and sleeps == [2, 4]
    assert client.stats.requests == 3 and client.stats.retries == 2


def test_retries_timeouts():
    client, calls, _ = make([httpx2.ConnectTimeout("stall"), httpx2.ReadTimeout("slow"), ok()], pause_s=0)
    assert client.get_json("/x") == []
    assert len(calls) == 3


def test_gives_up_after_max_retries():
    client, calls, _ = make([httpx2.Response(502)] * 4, max_retries=3, pause_s=0)
    with pytest.raises(SourceError):
        client.get_json("/x")
    assert len(calls) == 4


def test_repeated_rate_limit_stops():
    client, calls, _ = make([httpx2.Response(429), httpx2.Response(430), ok()], pause_s=0)
    with pytest.raises(RateLimitedError):
        client.get_json("/x")
    assert len(calls) == 2


def test_single_rate_limit_is_retried_honouring_retry_after():
    client, _, sleeps = make([httpx2.Response(429, headers={"Retry-After": "30"}), ok()], pause_s=0)
    assert client.get_json("/x") == []
    assert sleeps == [30]


def test_other_4xx_not_retried():
    client, calls, _ = make([httpx2.Response(404)], pause_s=0)
    with pytest.raises(SourceError):
        client.get_json("/x")
    assert len(calls) == 1


def test_pause_between_requests():
    client, _, sleeps = make([ok(), ok()], pause_s=5)
    client.get_json("/a")
    client.get_json("/b")
    assert sleeps == [4]  # fake clock advanced 1 s between the two requests
