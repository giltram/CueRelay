"""Explicit one-time v1 -> v2 upgrade; HTTP never implicitly accepts v1 writes."""
from copy import deepcopy
from .codec import parse_ass, serialize_ass
from .errors import fail


def upgrade_legacy_document(legacy):
    if not isinstance(legacy, dict) or set(legacy) != {'source', 'styles', 'cues'}:
        fail('旧文档字段不符合迁移契约')
    document = parse_ass(legacy['source'])
    ids = {style['name']: style['id'] for style in document['styles']}
    if legacy['styles'] != list(ids) or not isinstance(legacy['cues'], list):
        fail('旧文档样式与原始模板不一致')
    cues = []
    for cue in legacy['cues']:
        if not isinstance(cue, dict) or 'style' not in cue or 'style_id' in cue or not isinstance(cue['style'], str) or cue['style'] not in ids:
            fail('旧字幕引用无效，迁移已中止')
        cues.append({**{key: deepcopy(value) for key, value in cue.items() if key != 'style'}, 'style_id': ids[cue['style']]})
    document['cues'] = cues
    serialize_ass(document)  # Entire snapshot including metadata/anchors validated before any write.
    return document
