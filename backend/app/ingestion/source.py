from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.domain.chain import BlockHeader, ChainBlock


class SourceError(Exception):
    """The block source could not deliver valid data."""


class RateLimitedError(SourceError):
    """The block source rate-limited us repeatedly. Stop instead of retrying further."""


@dataclass
class SourceStats:
    requests: int = 0
    retries: int = 0
    bytes: int = 0


@runtime_checkable
class BlockSource(Protocol):
    """Delivers normalized chain data. Implementations hide every detail of the external API."""

    def list_block_headers(self, start: datetime, end: datetime) -> list[BlockHeader]:
        """Headers of blocks the source lists for the window [start, end). May include blocks outside it."""
        ...

    def get_block(self, height: int) -> ChainBlock:
        """The main-chain block at `height` with all its transactions."""
        ...

    def stats(self) -> SourceStats:
        ...
