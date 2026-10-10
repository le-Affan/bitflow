from datetime import datetime, timedelta

from app.domain.chain import BlockHeader, ChainBlock
from app.ingestion.source import SourceStats
from app.sources.blockchain_info.client import HttpClient
from app.sources.blockchain_info.normalizer import normalize_block, normalize_headers

DEFAULT_BASE_URL = "https://blockchain.info"
LISTING_WINDOW = timedelta(hours=24)


class BlockchainInfoSource:
    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list_block_headers(self, start: datetime, end: datetime) -> list[BlockHeader]:
        # /blocks/{ms} lists the blocks of the 24 h before {ms} (measured), so query backwards from `end`.
        headers: dict[int, BlockHeader] = {}
        cursor = end
        while cursor > start:
            ms = int(cursor.timestamp() * 1000)
            for h in normalize_headers(self._client.get_json(f"/blocks/{ms}?format=json")):
                headers[h.height] = h
            cursor -= LISTING_WINDOW
        return sorted(headers.values(), key=lambda h: h.height)

    def get_block(self, height: int) -> ChainBlock:
        return normalize_block(self._client.get_json(f"/block-height/{height}?format=json"), height)

    def stats(self) -> SourceStats:
        return self._client.stats
