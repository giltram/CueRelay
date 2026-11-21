"""Pure SRT conversion to/from the existing v2 ASS document contract."""
from uuid import uuid4

from ass_format import MAX_TIME, empty_document, parse_ass, serialize_ass
from .blocks import check_size, read_blocks
from .errors import SrtError
from .text import from_ass, to_ass


def parse_srt(source):
    """Accept the complete file, using the same defaults as a new ASS document.

    Boundaries round to the nearest 10ms, ties upward (confirmed product policy).
    Monotone rounding preserves ordering, and can collapse short cues to zero.
    """
    blocks = read_blocks(source)
    document = empty_document()
    style_id = document['styles'][0]['id']
    for block in blocks:
        start, end = [(time + 5) // 10 * 10 for time in (block.start_ms, block.end_ms)]
        if end > MAX_TIME:
            raise SrtError('srt.invalidInterval', '入点不能晚于出点，边界须为 0–35999990ms；不自动裁剪。',
                           line=block.line + 1, block=block.number)
        document['cues'].append({'id': 'new-' + str(uuid4()), 'start_ms': start,
                                  'end_ms': end, 'style_id': style_id,
                                  'text': to_ass(block.text, block)})
    # Canonical ASS source anchors contain every imported cue. Existing project
    # creation can consume source unchanged, without a format field or migration.
    return parse_ass(serialize_ass(document))


def _timestamp(ms):
    hours, rest = divmod(ms, 3600000)
    minutes, rest = divmod(rest, 60000)
    seconds, millis = divmod(rest, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{millis:03}'


def serialize_srt(document):
    """Validate the unified document, then export cues in document event order.

    Includes empty text and zero-duration cues, numbers continuously from 1,
    emits LF and a blank line after each block; never mutates the snapshot.
    """
    serialize_ass(document)
    styles = {style['id']: style['fields'] for style in document['styles']}
    output = []
    for number, cue in enumerate(document['cues'], 1):
        body, plain = from_ass(cue['text'], styles[cue['style_id']])
        # Blank physical lines are SRT block separators. Do not merge/trim them
        # or emit an output our importer would reinterpret as additional blocks.
        if plain and any(line == '' for line in plain.split('\n')):
            raise SrtError('srt.blankTextLine', '正文含开头、末尾或连续换行，SRT 无法无歧义保留；请使用 ASS 导出。', block=number)
        if any('-->' in line and len(line) >= 3 and line[:2].isdigit() and line[2] == ':' for line in plain.split('\n')):
            raise SrtError('srt.timingInText', '正文包含类似时间轴的独立行，SRT 无法无歧义保留；请使用 ASS 导出。', block=number)
        output.append(f'{number}\n{_timestamp(cue["start_ms"])} --> {_timestamp(cue["end_ms"])}\n{body}\n\n')
    result = ''.join(output)
    check_size(result)
    return result
