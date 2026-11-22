"""Read-only reference DTO: exact milliseconds and safe plain text, never ASS."""
from .blocks import read_blocks
from .text import to_plain


def parse_reference_srt(source):
    return [{'start_ms': block.start_ms, 'end_ms': block.end_ms,
             'text': to_plain(block.text, block)} for block in read_blocks(source)]
