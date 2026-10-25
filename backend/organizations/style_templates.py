"""Public template snapshots and mutations. User -> Organization -> Template locks."""
from copy import deepcopy
from django.core.exceptions import ValidationError
from django.db import transaction
from accounts.models import User
from ass_format import validate_fields, validate_name, validate_script
from .models import Organization, OrganizationStyleTemplate as Template
from .services import require_access


class TemplateConflict(Exception):
    pass


def _organization(actor, organization_id, manage=False, lock=False):
    if lock:
        User.objects.select_for_update().get(pk=actor.pk)
    query = Organization.objects.select_for_update() if lock else Organization.objects
    org = query.get(pk=organization_id)
    require_access(actor, org, manage)
    return org


def _data(template):
    return {'id': str(template.pk), 'name': template.name, 'fields': deepcopy(template.fields),
            'reference': deepcopy(template.reference), 'source_label': template.source_label,
            'revision': template.revision, 'created_at': template.created_at.isoformat(),
            'updated_at': template.updated_at.isoformat(), 'updated_by': {'username': template.updated_by.username}}


def _revision(template, revision):
    if type(revision) is not int or revision < 1:
        raise ValidationError('模板 revision 须为正整数。')
    if template.revision != revision:
        raise TemplateConflict('模板已更新，请重新加载后检查；当前输入已保留。')


def list_templates(actor, organization_id):
    org = _organization(actor, organization_id)
    return [_data(row) for row in Template.objects.filter(organization=org).select_related('updated_by').order_by('name', 'id')]


def template_snapshot(actor, organization_id, template_id, revision):
    """For copy-on-import. Caller holds Organization lock throughout its transaction."""
    org = _organization(actor, organization_id)
    template = Template.objects.select_related('updated_by').get(pk=template_id, organization=org)
    _revision(template, revision)
    return _data(template)


def _validate(org, name, fields, reference, source_label, exclude=None):
    validate_name(name); validate_fields(fields); validate_script(reference)
    if (not isinstance(source_label, str) or len(source_label) > 500
            or any(ord(c) < 32 or c in '\u0085\u2028\u2029' for c in source_label)):
        raise ValidationError('来源说明须为不超过 500 字符的单行文字。')
    try:
        source_label.encode('utf-8')
    except UnicodeError:
        raise ValidationError('来源说明编码无效。')
    if Template.objects.filter(organization=org, name=name).exclude(pk=exclude).exists():
        raise ValidationError('组织内模板名称须唯一。')


@transaction.atomic
def create_template(actor, organization_id, *, name, fields, reference, source_label):
    org = _organization(actor, organization_id, manage=True, lock=True)
    _validate(org, name, fields, reference, source_label)
    if Template.objects.filter(organization=org).count() >= 1000:
        raise ValidationError('当前组织最多保存 1000 个模板。')
    template = Template.objects.create(organization=org, name=name, fields=fields, reference=reference,
        source_label=source_label, created_by=actor, updated_by=actor)
    return _data(template)


@transaction.atomic
def update_template(actor, organization_id, template_id, *, revision, name, fields, reference, source_label):
    org = _organization(actor, organization_id, manage=True, lock=True)
    template = Template.objects.select_for_update().get(pk=template_id, organization=org)
    _revision(template, revision)
    _validate(org, name, fields, reference, source_label, exclude=template.pk)
    if (template.name, template.fields, template.reference, template.source_label) != (name, fields, reference, source_label):
        template.name, template.fields, template.reference, template.source_label = name, fields, reference, source_label
        template.revision += 1; template.updated_by = actor
        template.save()
    return _data(template)


@transaction.atomic
def delete_template(actor, organization_id, template_id, *, revision):
    org = _organization(actor, organization_id, manage=True, lock=True)
    template = Template.objects.select_for_update().get(pk=template_id, organization=org)
    _revision(template, revision)
    template.delete()  # Snapshot origins are informational UUIDs, never cascading FKs.
