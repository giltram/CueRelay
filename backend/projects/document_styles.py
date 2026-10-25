"""Template import orchestration; caller owns Organization lock + Project transaction."""
from django.core.exceptions import ValidationError
from ass_format import import_style_snapshots, validate_id
from organizations.style_templates import template_snapshot


def _snapshot(actor, organization_id, operation):
    if not isinstance(operation, dict) or set(operation) != {'type', 'template_id', 'revision', 'name', 'mode'} or operation['type'] != 'import':
        raise ValidationError('模板导入字段无效。')
    validate_id(operation['template_id'])
    return template_snapshot(actor, organization_id, operation['template_id'], operation['revision'])


def import_templates(actor, organization_id, document, imports):
    if not isinstance(imports, list) or len(imports) > 1000:
        raise ValidationError('模板导入列表无效。')
    snapshots = [(_snapshot(actor, organization_id, operation), operation['name'], operation['mode']) for operation in imports]
    return import_style_snapshots(document, snapshots) if snapshots else document
