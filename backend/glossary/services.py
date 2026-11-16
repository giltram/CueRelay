"""Public organization glossary API. No project, HTTP, workspace or ASS dependency.

Writes lock User -> Organization -> Glossary -> Entry. Project orchestration may
already hold the first two locks and its Project lock. No lower service locks projects.
"""
from message_contracts import localized
import json
from pathlib import Path
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from accounts.models import User
from organizations.models import Organization
from organizations.services import require_access
from .models import Glossary, Entry

LIMITS = json.loads((Path(__file__).resolve().parents[2] / 'shared/glossary-limits.json').read_text())


class GlossaryConflict(Exception):
    def __init__(self, message=localized('server.thisEntryChangedElsewhereYourInputsHaveBeenKept', '词条已被其他人修改，当前输入已保留。请重新加载服务器词条后再编辑。', {}), code='glossary_conflict'):
        self.message, self.code = message, code


def text(value, field, required=True):
    if not isinstance(value, str):
        raise ValidationError(localized('server.enterPlainText', '请填写普通文本。', {}))
    value = value.strip()
    if len(value) > LIMITS[field] or (required and not value) or '\0' in value:
        raise ValidationError(localized('server.valueMustBeValueValueCharacters', '{{v0}} 须为 {{v1}}–{{v2}} 个字符。', {'v0': field, 'v1': 1 if required else 0, 'v2': LIMITS[field]}))
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValidationError(localized('server.invalidTextEncoding', '文字编码无效。', {}))
    return value


def entry_values(original, translation, note):
    return dict(original=text(original, 'original'), translation=text(translation, 'translation'), note=text(note, 'note', False))


def organization_for(actor, organization_id, lock=False):
    if lock:
        User.objects.select_for_update().get(pk=actor.pk)
    org = (Organization.objects.select_for_update() if lock else Organization.objects).get(pk=organization_id)
    require_access(actor, org)
    return org


def table_data(table):
    return {'id': str(table.pk), 'name': table.name, 'created_at': table.created_at.isoformat(),
            'is_organization_default': table.is_organization_default}


def entry_data(entry):
    return {'id': str(entry.pk), 'original': entry.original, 'translation': entry.translation, 'note': entry.note,
            'revision': entry.revision, 'updated_by': {'username': entry.updated_by.username}, 'updated_at': entry.updated_at.isoformat()}


def table_summary(actor, organization_id, table_id):
    org = organization_for(actor, organization_id)
    return table_data(Glossary.objects.get(pk=table_id, organization=org))


def page_number(value):
    if type(value) is not int or not 1 <= value <= 1_000_000:
        raise ValidationError(localized('server.invalidPageNumber', '页码无效。', {}))
    return value


def list_entries(actor, organization_id, table_id, search='', page=1):
    org = organization_for(actor, organization_id)
    table = Glossary.objects.get(pk=table_id, organization=org)
    search, page = text(search, 'search', False), page_number(page)
    query = table.entries.filter(Q(original__icontains=search) | Q(translation__icontains=search) | Q(note__icontains=search))
    query = query.select_related('updated_by').order_by('original', 'id')
    total = query.count()
    size = LIMITS['page_size']
    return {'entries': [entry_data(row) for row in query[(page-1)*size:page*size]],
            'total': total, 'page': page, 'has_more': page*size < total, 'empty': not table.entries.exists()}


def read_entry(actor, organization_id, table_id, entry_id):
    org = organization_for(actor, organization_id)
    return entry_data(Entry.objects.select_related('updated_by').get(pk=entry_id, glossary_id=table_id, glossary__organization=org))


@transaction.atomic
def save_entry(actor, organization_id, table_id, *, original, translation, note, entry_id=None, revision=None):
    values = entry_values(original, translation, note)
    org = organization_for(actor, organization_id, lock=True)
    table = Glossary.objects.select_for_update().get(pk=table_id, organization=org)
    entry = None if entry_id is None else Entry.objects.select_for_update().get(pk=entry_id, glossary=table)
    if entry is not None and (type(revision) is not int or revision != entry.revision):
        raise GlossaryConflict()
    duplicate = table.entries.filter(original=values['original'], translation=values['translation'])
    if entry is not None:
        duplicate = duplicate.exclude(pk=entry.pk)
    if duplicate.exists():
        raise ValidationError(localized('server.thisOriginalTermAndPreferredTranslationAlreadyExist', '此原词和统一译名已存在。', {}))
    if entry is None:
        entry = Entry.objects.create(glossary=table, updated_by=actor, **values)
    elif any(getattr(entry, key) != value for key, value in values.items()):
        for key, value in values.items():
            setattr(entry, key, value)
        entry.revision += 1
        entry.updated_by = actor
        entry.save()
    return entry_data(entry)


@transaction.atomic
def organization_table(actor, organization_id, *, create=False):
    """The sole default table is immutable in identity; reads never create rows."""
    org = organization_for(actor, organization_id, lock=create)
    table = Glossary.objects.filter(organization=org, is_organization_default=True).first()
    if table is None and create:
        table = Glossary.objects.create(organization=org, is_organization_default=True, name='组织术语表', created_by=actor)
    return table_data(table) if table else None


def check_organization_token(table, association_version, glossary_id):
    if type(association_version) is not int or association_version != 1:
        raise ValidationError(localized('server.invalidOrganizationDefaultGlossaryVersion', '组织默认表版本无效。', {}))
    # A virtual empty default can become concrete while another form is open.
    # Its identity cannot be replaced, so the original null token remains safe.
    if glossary_id is not None and glossary_id != (table['id'] if table else None):
        raise GlossaryConflict(localized('server.theOrganizationGlossaryChangedRefreshAndTryAgain', '组织术语表已变化，请刷新后重试。', {}), 'glossary_association_conflict')


@transaction.atomic
def save_organization_entry(actor, organization_id, *, association_version, glossary_id, original, translation, note, entry_id=None, revision=None):
    entry_values(original, translation, note)
    organization_for(actor, organization_id, lock=True)
    table = organization_table(actor, organization_id)
    check_organization_token(table, association_version, glossary_id)
    if entry_id is not None and table is None:
        raise GlossaryConflict()
    table = table or organization_table(actor, organization_id, create=True)
    return save_entry(actor, organization_id, table['id'], original=original, translation=translation, note=note,
                      entry_id=entry_id, revision=revision)


@transaction.atomic
def fork_organization_table(actor, organization_id, name):
    """Copy the current organization entries, with new IDs and no live linkage."""
    org = organization_for(actor, organization_id, lock=True)
    source = Glossary.objects.filter(organization=org, is_organization_default=True).first()
    target = Glossary.objects.create(organization=org, name=text(name, 'name'), created_by=actor)
    if source:
        # Organization writes use the same organization lock, so this bounded
        # streaming copy is a consistent snapshot, even for large tables.
        batch = []
        for row in source.entries.order_by('pk').values('original', 'translation', 'note').iterator(chunk_size=500):
            batch.append(Entry(glossary=target, updated_by=actor, **row))
            if len(batch) == 500:
                Entry.objects.bulk_create(batch)
                batch = []
        if batch:
            Entry.objects.bulk_create(batch)
    return table_data(target)
