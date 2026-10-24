"""Pure, all-or-nothing splits of the bounded ASS document DTO."""
from uuid import uuid4
import unicodedata
from .codec import AssError, serialize_ass


def _fail(message):
    raise AssError(message)


def _cursor_index(text, position):
    # Browser textarea offsets count UTF-16 code units, Python indexes code points.
    if type(position) is not int or position <= 0:
        _fail('光标必须严格位于文本内部，且两侧均有文字。')
    units = 0
    for index, char in enumerate(text):
        if units == position:
            previous = text[index - 1]
            # Reject boundaries inside combining/emoji sequences rather than
            # separating a visible character across independent subtitles.
            if (unicodedata.category(char).startswith('M') or char in '\u200d\ufe0e\ufe0f'
                    or previous == '\u200d' or 0x1F3FB <= ord(char) <= 0x1F3FF
                    or 0x1F1E6 <= ord(previous) <= 0x1F1FF and 0x1F1E6 <= ord(char) <= 0x1F1FF):
                _fail('不能在组合字符或表情内部拆分。')
            return index
        units += 2 if ord(char) > 0xFFFF else 1
    _fail('光标必须严格位于文本内部，不能拆开 Unicode 字符。')


def split_document(document, cue_id, mode, position):
    """Return a new snapshot and two UUID identities; never mutate the input.

    mode=playhead: position is integer milliseconds on the 10ms grid, empty only.
    mode=text: position is the collapsed textarea cursor's UTF-16 offset.
    """
    serialize_ass(document)
    if not isinstance(cue_id, str):
        _fail('字幕 ID 无效。')
    index = next((i for i, cue in enumerate(document['cues']) if cue['id'] == cue_id), None)
    if index is None:
        _fail('请先选择一条字幕；该行可能已被删除。')
    cue = document['cues'][index]
    if mode == 'playhead':
        if cue['text']:
            _fail('含有文本的字幕请使用文本光标拆分，不能按播放头复制或丢弃文本。')
        if type(position) is not int or position % 10:
            _fail('拆分位置须为对齐 10ms 的整数毫秒。')
        split_at, left_text, right_text = position, '', ''
    elif mode == 'text':
        text = cue['text']
        if any(char in text for char in '{}\\'):
            _fail('当前只支持普通文本拆分；含 ASS 内联标签或转义（如 \\N）的字幕不能安全拆分。')
        cursor = _cursor_index(text, position)
        left_text, right_text = text[:cursor], text[cursor:]
        if not left_text.strip() or not right_text.strip():
            _fail('拆分后两侧均须有文字，不能只有空白。')
        ticks = (cue['end_ms'] - cue['start_ms']) // 10
        left_ticks = (ticks * len(left_text) * 2 + len(text)) // (2 * len(text))
        split_at = cue['start_ms'] + left_ticks * 10
    else:
        _fail('未知的拆分方式。')
    if not cue['start_ms'] < split_at < cue['end_ms']:
        _fail('拆分点必须严格位于入点和出点之间，时间须足够形成两条至少 10ms 的字幕。')
    left = {**cue, 'id': f'new-{uuid4()}', 'end_ms': split_at, 'text': left_text}
    right = {**cue, 'id': f'new-{uuid4()}', 'start_ms': split_at, 'text': right_text}
    # A source anchor owns Layer/Name/Margins, separate from editable identity.
    source_id = cue.get('source_id', cue['id'] if cue['id'].startswith('source-') else None)
    if source_id is not None:
        left['source_id'] = right['source_id'] = source_id
    result = {**document, 'cues': [*document['cues'][:index], left, right, *document['cues'][index + 1:]]}
    serialize_ass(result)  # Includes total event/byte limits and metadata validation.
    return {'document': result, 'first_id': left['id'], 'second_id': right['id']}
