"""Atomic immutable document operations. Persistent callers own authorization/CAS."""
from copy import deepcopy
from uuid import uuid4
from .codec import serialize_ass, _inspect
from .errors import fail
from .styles import ATTRIBUTE_FIELDS, adapt_fields, validate_fields, validate_name, validate_script


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail("样式操作包含缺失或未知字段")


def _ids(values, available):
    if (not isinstance(values, list) or not values or any(not isinstance(v, str) for v in values)
            or len(values) != len(set(values)) or not set(values) <= set(available)):
        fail("请选择唯一且属于当前文档的有效 ID；整批操作未执行")
    return set(values)


def _patch(fields):
    if not isinstance(fields, dict) or not fields or not set(fields) <= set(ATTRIBUTE_FIELDS):
        fail("请选择至少一个标准样式属性；批量编辑不接受名称或身份字段")


def style_usage(document):
    serialize_ass(document)
    _, layout = _inspect(document['source'])
    result = {style['id']: {'cues': 0, 'comments': 0} for style in document['styles']}
    anchors = {style['source_name']: style['id'] for style in document['styles'] if style['source_name'] is not None}
    for cue in document['cues']:
        result[cue['style_id']]['cues'] += 1
    for _, values in layout.comments.values():
        result[anchors[values['Style'].strip()]]['comments'] += 1
    return result


def apply_style_operation(document, operation):
    """Create/copy IDs here, never trust client identities or provenance for additions."""
    serialize_ass(document)
    if not isinstance(operation, dict) or not isinstance(operation.get('type'), str):
        fail("需要具名样式操作")
    result = deepcopy(document)
    by_id = {style['id']: style for style in result['styles']}
    kind = operation['type']
    if kind == 'create':
        _keys(operation, ['type', 'name', 'fields'])
        validate_name(operation['name']); validate_fields(operation['fields'])
        result['styles'].append({'id': str(uuid4()), 'name': operation['name'], 'fields': deepcopy(operation['fields']), 'source_name': None, 'origin': None})
    elif kind in ('update', 'copy'):
        _keys(operation, ['type', 'id', 'name', 'fields'])
        _ids([operation['id']], by_id)
        validate_name(operation['name'])
        if not isinstance(operation['fields'], dict) or not set(operation['fields']) <= set(ATTRIBUTE_FIELDS):
            fail("样式更新只能指定标准属性")
        style = by_id[operation['id']]
        if kind == 'copy':
            style = {**deepcopy(style), 'id': str(uuid4()), 'source_name': None}
            result['styles'].append(style)
        style['name'] = operation['name']
        style['fields'].update(operation['fields'])
    elif kind == 'batch':
        _keys(operation, ['type', 'ids', 'fields'])
        ids = _ids(operation['ids'], by_id)
        _patch(operation['fields'])
        for style_id in ids:
            by_id[style_id]['fields'].update(operation['fields'])
    elif kind == 'delete':
        _keys(operation, ['type', 'ids'])
        ids = _ids(operation['ids'], by_id)
        usage = style_usage(document)
        if any(usage[key]['cues'] or usage[key]['comments'] for key in ids):
            fail("样式仍被字幕或 ASS Comment 引用，不能删除；请先重新分配字幕")
        result['styles'] = [style for style in result['styles'] if style['id'] not in ids]
    elif kind == 'assign':
        _keys(operation, ['type', 'cue_ids', 'style_id'])
        _ids([operation['style_id']], by_id)
        ids = _ids(operation['cue_ids'], [cue['id'] for cue in result['cues']])
        for cue in result['cues']:
            if cue['id'] in ids:
                cue['style_id'] = operation['style_id']
    elif kind == 'script':
        _keys(operation, ['type', 'script'])
        validate_script(operation['script'])
        result['script'] = deepcopy(operation['script'])
    else:
        fail("未知样式操作")
    serialize_ass(result)
    return result


def import_style(document, template, name, mode):
    """template is an authorized, version-checked organization snapshot, not request data."""
    return import_style_snapshots(document, [(template, name, mode)])


def import_style_snapshots(document, snapshots):
    """Validate a multi-template import once, avoiding quadratic ASS reserialization."""
    serialize_ass(document)
    result = deepcopy(document)
    for template, name, mode in snapshots:
        validate_name(name)
        fields = adapt_fields(template['fields'], template['reference'], document['script'], mode)
        result['styles'].append({'id': str(uuid4()), 'name': name, 'fields': fields, 'source_name': None,
                                 'origin': {'template_id': template['id'], 'revision': template['revision']}})
    serialize_ass(result)
    return result
