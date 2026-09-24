"""Received-chunk bitmap for a chunked upload, stored as a hex string in rasters.received_chunks.

Bit n lives in byte n // 8 at mask 1 << (n % 8); "" (or None) means nothing received.
"""

from __future__ import annotations


def _bytes(bitmap: str | None) -> bytearray:
    return bytearray.fromhex(bitmap) if bitmap else bytearray()


# A malformed column must fail loudly: silently reading it as empty would re-request every chunk.
def set_bit(bitmap: str | None, n: int) -> str:
    if n < 0:
        raise ValueError("chunk index must be >= 0")
    data = _bytes(bitmap)
    index = n >> 3
    if len(data) <= index:
        data.extend(b"\x00" * (index + 1 - len(data)))
    data[index] |= 1 << (n & 7)
    return data.hex()


def get_bit(bitmap: str | None, n: int) -> bool:
    data = _bytes(bitmap)
    index = n >> 3
    return 0 <= n and index < len(data) and bool(data[index] & (1 << (n & 7)))


def count(bitmap: str | None) -> int:
    return sum(byte.bit_count() for byte in _bytes(bitmap))


def received(bitmap: str | None, chunk_count: int) -> list[int]:
    data = _bytes(bitmap)
    return [n for n in range(chunk_count)
            if (n >> 3) < len(data) and data[n >> 3] & (1 << (n & 7))]


def missing(bitmap: str | None, chunk_count: int) -> list[int]:
    have = set(received(bitmap, chunk_count))
    return [n for n in range(chunk_count) if n not in have]
