"""Plain-text ASS clipboard interchange; pure transformations, no persistence."""
from uuid import uuid4
from .codec import CUE_FIELDS, EVENT_FIELDS, MAX_BYTES, MAX_CUES, _inspect, empty_document, serialize_ass
from .errors import fail

PASTE_FIELDS = {'start_ms', 'end_ms', 'style_id', 'text'}


def copy_lines(document, ids):
    serialize_ass(document)
    selected = _selection(document, ids)
    snapshot = {**document, 'cues': [cue for cue in document['cues'] if cue['id'] in selected]}
    _, layout = _inspect(serialize_ass(snapshot))
    lines = []
    for _, fields, parts in layout.records.values():
        values = dict(zip(fields, parts))
        lines.append('Dialogue: ' + ','.join(values[field] for field in EVENT_FIELDS))
    return '\r\n'.join(lines)


def _selection(document, ids):
    if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids):
        fail('请选择字幕行')
    selected = set(ids)
    if len(selected) != len(ids) or not selected <= {c['id'] for c in document['cues']}:
        fail('选中的字幕行已不存在或重复')
    return selected


def paste_lines(document, text, active_id, ids, fields=None):
    """Insert before active, or overwrite selected fields; single selection runs
    downwards in document order. Multi-selection touches only selected rows.
    New rows retain bounded hidden ASS fields without replacing the source template.
    """
    serialize_ass(document)
    empty_insert = not document['cues'] and ids == [] and active_id is None and fields is None
    selected = set() if empty_insert else _selection(document, ids)
    if not empty_insert and (not isinstance(active_id, str) or active_id not in selected):
        fail('当前字幕行不在选择范围内')
    if fields is not None and (not isinstance(fields, list) or not fields
                              or any(not isinstance(f, str) for f in fields)
                              or not set(fields) <= PASTE_FIELDS or len(set(fields)) != len(fields)):
        fail('请选择入点、出点、样式、正文中的覆盖字段')
    if not isinstance(text, str) or len(text.encode('utf-8')) > MAX_BYTES:
        fail('剪贴板须为不超过 1MiB 的文本')
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines or len(lines) > MAX_CUES:
        fail('剪贴板须包含 1–5000 行字幕')

    active_index = 0 if empty_insert else next(i for i, cue in enumerate(document['cues']) if cue['id'] == active_id)
    fallback = document['styles'][0]['id'] if empty_insert else document['cues'][active_index]['style_id']
    names = {s['name']: s['id'] for s in document['styles']}
    source_style = 'Default'
    raw_lines, style_ids = [], []
    for line in lines:
        if line.startswith('Dialogue:'):
            parts = line[len('Dialogue:'):].lstrip().split(',', 9)
            if len(parts) != 10:
                fail('剪贴板 ASS Dialogue 字段不完整')
            values = dict(zip(EVENT_FIELDS, parts))
            style_ids.append(names.get(values['Style'].strip(), fallback))
            # Validate against a standalone neutral template; target style IDs
            # and the immutable project source are never replaced.
            values['Style'] = source_style
        elif line.startswith(('Comment:', '[', 'Format:')):
            fail('请复制 ASS Dialogue 行或普通文本，不要粘贴整个 ASS 文件')
        else:
            values = dict(zip(EVENT_FIELDS, ['0', '0:00:00.00', '0:00:03.00', source_style,
                                             '', '0000', '0000', '0000', '', line]))
            style_ids.append(fallback)
        raw_lines.append('Dialogue: ' + ','.join(values[f] for f in EVENT_FIELDS))

    source = empty_document()['source'] + '\n'.join(raw_lines) + '\n'
    parsed, layout = _inspect(source)
    incoming = []
    for cue, style_id in zip(parsed['cues'], style_ids):
        _, record_fields, parts = layout.records[cue['id']]
        values = dict(zip(record_fields, parts))
        incoming.append({'id': f'new-{uuid4()}', 'ass_fields': {key: values[key] for key in CUE_FIELDS},
                         'start_ms': cue['start_ms'], 'end_ms': cue['end_ms'],
                         'text': cue['text'], 'style_id': style_id})

    cues = list(document['cues'])
    if fields is None:
        cues[active_index:active_index] = incoming
        result = {**document, 'cues': cues}
        result_ids = [cue['id'] for cue in incoming]
    else:
        targets = ([i for i, cue in enumerate(cues) if cue['id'] in selected] if len(selected) > 1
                   else list(range(active_index, len(cues))))
        for index, cue in zip(targets, incoming):
            cues[index] = {**cues[index], **{field: cue[field] for field in fields}}
        result = {**document, 'cues': cues}
        result_ids = ids
    serialize_ass(result)
    return {'document': result, 'selected_ids': result_ids}
