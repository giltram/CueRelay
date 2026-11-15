"""Resolve organization defaults and explicit project snapshots independently of ASS.

Lock order User -> Organization -> Project -> Glossary -> Entry. Only the project
module owns associations/reference counts; glossary owns copying and entry data.
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from glossary import services as glossary
from .models import Project
from .services import organization_for, require_active


def context_project(actor, organization_id, project_id, *, write=False, manage=False):
    org, _ = organization_for(actor, organization_id, manage=manage, lock=write)
    project = (Project.objects.select_for_update() if write else Project.objects).get(pk=project_id, organization=org)
    if write:
        require_active(project)
    return project


def association_conflict():
    return glossary.GlossaryConflict('项目术语表关联已变化，当前输入已保留。请刷新术语表后重试。', 'glossary_association_conflict')


def effective_table(actor, project):
    if project.glossary_id:
        return glossary.table_summary(actor, project.organization_id, project.glossary_id)
    return glossary.organization_table(actor, project.organization_id)


def check_association(project, version, table_id, table):
    if type(version) is not int or version < 1:
        raise ValidationError('association_version 必须是正整数。')
    if table_id is not None and not isinstance(table_id, str):
        raise ValidationError('glossary_id 必须为 UUID 或 null。')
    matches = table_id == (table['id'] if table else None)
    # The implicit organization default has one immutable identity. A virtual
    # empty table token may safely survive its first successful creation.
    if project.glossary_id is None and table_id is None:
        matches = True
    if version != project.glossary_version or not matches:
        raise association_conflict()


def project_count(organization_id, table):
    query = Q(glossary_id=table['id'])
    if table['is_organization_default']:
        query |= Q(glossary__isnull=True)
    return Project.objects.filter(query, organization_id=organization_id).count()


def context_data(actor, project):
    table = effective_table(actor, project)
    if table:
        table['project_count'] = project_count(project.organization_id, table)
    return {'association_version': project.glossary_version, 'table': table, 'archived': project.status == 'archived',
            'uses_organization_default': project.glossary_id is None}


def read_context(actor, organization_id, project_id, *, search='', page=1):
    project = context_project(actor, organization_id, project_id)
    data = context_data(actor, project)
    data.update(entry_page(actor, organization_id, data['table'], search, page))
    return data


def entry_page(actor, organization_id, table, search, page):
    if table:
        return glossary.list_entries(actor, organization_id, table['id'], search, page)
    glossary.text(search, 'search', False)
    glossary.page_number(page)
    return dict(entries=[], total=0, page=page, has_more=False, empty=True)


def read_entry(actor, organization_id, project_id, table_id, entry_id):
    project = context_project(actor, organization_id, project_id)
    table = effective_table(actor, project)
    if not table or table['id'] != str(table_id):
        raise association_conflict()
    return glossary.read_entry(actor, organization_id, table_id, entry_id)


@transaction.atomic
def change_association(actor, organization_id, project_id, *, association_version, glossary_id, fork=False, use_organization_default=False):
    if type(fork) is not bool or type(use_organization_default) is not bool or fork == use_organization_default:
        raise ValidationError('请选择创建项目副本或使用组织术语表。')
    # Creating a private copy is an entry-maintenance action, available to members.
    # Switching an existing project's association back retains management permissions.
    project = context_project(actor, organization_id, project_id, write=True, manage=use_organization_default)
    table = effective_table(actor, project)
    check_association(project, association_version, glossary_id, table)
    if fork:
        if project.glossary_id is not None:
            raise association_conflict()
        table = glossary.fork_organization_table(actor, organization_id, project.name)
        project.glossary_id = table['id']
    else:
        project.glossary_id = None
    project.glossary_version += 1
    project.save(update_fields=['glossary', 'glossary_version'])
    return context_data(actor, project)


@transaction.atomic
def save_entry(actor, organization_id, project_id, *, association_version, glossary_id, original, translation, note, entry_id=None, revision=None):
    glossary.entry_values(original, translation, note)
    project = context_project(actor, organization_id, project_id, write=True)
    table = effective_table(actor, project)
    check_association(project, association_version, glossary_id, table)
    if project.glossary_id is None or table['is_organization_default']:
        raise glossary.GlossaryConflict('组织术语表只在组织设置中维护。请先创建项目副本，再修改项目词条。', 'organization_glossary_read_only')
    entry = glossary.save_entry(actor, organization_id, project.glossary_id, original=original, translation=translation,
                                note=note, entry_id=entry_id, revision=revision)
    return {**context_data(actor, project), 'entry': entry}


def read_organization_context(actor, organization_id, *, search='', page=1):
    table = glossary.organization_table(actor, organization_id)
    if table:
        table['project_count'] = project_count(organization_id, table)
    return dict(association_version=1, table=table, archived=False, uses_organization_default=True,
                **entry_page(actor, organization_id, table, search, page))


@transaction.atomic
def save_organization_entry(actor, organization_id, **values):
    entry = glossary.save_organization_entry(actor, organization_id, **values)
    data = read_organization_context(actor, organization_id)
    return {key: data[key] for key in ('association_version', 'table', 'archived', 'uses_organization_default')} | {'entry': entry}


def read_organization_entry(actor, organization_id, table_id, entry_id):
    table = glossary.organization_table(actor, organization_id)
    if not table or table['id'] != str(table_id):
        raise association_conflict()
    return glossary.read_entry(actor, organization_id, table_id, entry_id)
