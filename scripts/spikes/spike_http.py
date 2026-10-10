"""Tiny HTTP helper for the data-source spike. Throwaway code.

Uses curl instead of urllib: on this machine some mempool.space IPs time out on
connect, and urllib waits the full timeout per address while curl moves on fast.
"""
import json
import subprocess
import time

UA = "BitFlow-spike/0.1 (feasibility test)"
LIMIT_HEADERS = ("ratelimit", "retry-after")


class Counter:
    def __init__(self, name):
        self.name = name
        self.requests = 0
        self.statuses = {}
        self.bytes = 0
        self.last_headers = {}

    def _curl(self, url):
        p = subprocess.run(
            ["curl", "-sS", "-4", "--compressed", "-m", "60", "--connect-timeout", "10",
             "-A", UA, "-D", "-", url],
            capture_output=True, check=True,
        )
        raw = p.stdout
        # curl -D - prints headers (possibly several blocks on redirects) then body.
        head, _, body = raw.partition(b"\r\n\r\n")
        while body.startswith(b"HTTP/"):
            head, _, body = body.partition(b"\r\n\r\n")
        lines = head.decode("latin-1").split("\r\n")
        status = int(lines[0].split()[1])
        headers = {}
        for line in lines[1:]:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
        return status, headers, body

    def get(self, url, raw=False, retries=3):
        for attempt in range(retries + 1):
            self.requests += 1
            status, headers, body = self._curl(url)
            self.statuses[status] = self.statuses.get(status, 0) + 1
            self.bytes += len(body)
            self.last_headers = {k: v for k, v in headers.items()
                                 if any(h in k for h in LIMIT_HEADERS)}
            if status == 200:
                return body if raw else json.loads(body)
            print(f"[{self.name}] HTTP {status} on {url} limit_headers={self.last_headers} body={body[:200]!r}",
                  flush=True)
            if status in (402, 429, 430, 503) and attempt < retries:
                wait = int(headers.get("retry-after", "0") or 0) or 10 * (attempt + 1)
                time.sleep(wait)
                continue
            raise RuntimeError(f"{self.name}: HTTP {status} for {url}")

    def summary(self):
        return {"api": self.name, "requests": self.requests, "statuses": self.statuses, "bytes": self.bytes}
