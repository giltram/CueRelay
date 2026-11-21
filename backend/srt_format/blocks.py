"""Strict SRT block framing. Timestamps retain their original millisecond precision."""
from dataclasses import dataclass
import re

from ass_format import MAX_BYTES, MAX_CUES, MAX_TIME
from .errors import SrtError

TIMING = re.compile(r'([0-9]{2}):([0-5][0-9]):([0-5][0-9]),([0-9]{3})[ \t]+-->[ \t]+'
                    r'([0-9]{2}):([0-5][0-9]):([0-5][0-9]),([0-9]{3})')


@dataclass(frozen=True)
class Block:
    number: int
    line: int
    start_ms: int
    end_ms: int
    text: str


def check_size(source):
    if not isinstance(source, str):
        raise SrtError('srt.textRequired', 'SRT 须为 UTF-8 文本。')
    try:
        size = len(source.encode('utf-8'))
    except UnicodeError as error:
        raise SrtError('srt.invalidUnicode', 'SRT 包含非法 Unicode。') from error
    if size > MAX_BYTES:
        raise SrtError('srt.tooLarge', 'SRT 文本不能超过 1MiB。')


def read_blocks(source):
    """Accept every block or fail; never search past unrecognized input."""
    check_size(source)
    source = source.removeprefix('\ufeff').replace('\r\n', '\n')
    lines = source.split('\n')
    blocks = []
    cursor = 0
    while cursor < len(lines):
        if lines[cursor] == '':
            cursor += 1
            continue
        first = cursor
        number = len(blocks) + 1
        location = {'line': first + 1, 'block': number}
        if number > MAX_CUES:
            raise SrtError('srt.tooManyBlocks', '最多接受 5000 个字幕块。', **location)
        if not re.fullmatch(r'[0-9]+', lines[cursor]):
            raise SrtError('srt.numberRequired', '需要独占一行的非负整数序号；不能跳过无法识别的内容。', **location)
        cursor += 1
        match = TIMING.fullmatch(lines[cursor]) if cursor < len(lines) else None
        if not match:
            raise SrtError('srt.invalidTiming', '时间须使用 HH:MM:SS,mmm --> HH:MM:SS,mmm。',
                           line=cursor + 1, block=number)
        values = list(map(int, match.groups()))
        start, end = [(h * 3600 + m * 60 + s) * 1000 + ms
                      for h, m, s, ms in (values[:4], values[4:])]
        if start > end or start > MAX_TIME or end > MAX_TIME:
            raise SrtError('srt.invalidInterval', '入点不能晚于出点，边界须为 0–35999990ms；不自动裁剪。',
                           line=cursor + 1, block=number)
        cursor += 1
        text_start = cursor
        while cursor < len(lines) and lines[cursor] != '':
            # A missing separator must not turn another block into dialogue.
            if TIMING.fullmatch(lines[cursor]) or '-->' in lines[cursor] and re.match(r'[0-9]{2}:', lines[cursor]):
                raise SrtError('srt.missingSeparator', '字幕块间需要空行；正文中不能有独立时间行。',
                               line=cursor + 1, block=number)
            cursor += 1
        blocks.append(Block(number, first + 1, start, end, '\n'.join(lines[text_start:cursor])))
    return blocks
