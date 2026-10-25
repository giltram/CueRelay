"""Public project operations. Actor User -> Organization -> Project is the write lock order.

All writes reauthorize under the organization lock, serializing membership removal
with project changes. Media and the original ASS template cannot be replaced.
"""
import re
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from ass_format import empty_document, parse_ass, serialize_ass, split_document as split_ass_document
from accounts.models import User
from organizations.models import Organization
from organizations.services import require_access
from .models import Project
from .document_styles import import_initial_templates
from ass_format import validate_script


class ProjectConflict(Exception):
    def __init__(self, code='project_conflict', message='项目已被其他操作更新，请刷新后重试；当前输入已保留。'):
        self.code = code
        self.message = message


def text(value, length, required=False):
    if not isinstance(value, str) or len(value) > length or '\0' in value:
        raise ValidationError(f'文字须在 {length} 字符以内。')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValidationError('文字编码无效。')
    value = value.strip()
    if required and not value:
        raise ValidationError('项目名称不能为空。')
    return value


def validate_media(media):
    if not isinstance(media, dict) or set(media) != {'sha256', 'size', 'duration_ms'}:
        raise ValidationError('媒体只接受 sha256、size、duration_ms，不接受路径或媒体字节。')
    if not isinstance(media['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', media['sha256']):
        raise ValidationError('视频 SHA-256 无效。')
    if type(media['size']) is not int or not 0 < media['size'] <= 9_007_199_254_740_991:
        raise ValidationError('视频大小无效。')
    if type(media['duration_ms']) is not int or not 0 < media['duration_ms'] < 36_000_000:
        raise ValidationError('视频时长须在 0–10 小时之间。')
    return media


def check_revision(project, revision):
    if type(revision) is not int or revision < 1:
        raise ValidationError('revision 必须是正整数。')
    if project.revision != revision:
        raise ProjectConflict()


def require_active(project):
    if project.status != Project.Status.ACTIVE:
        raise ProjectConflict('project_archived', '项目已归档，仅可查看和导出。请由管理员恢复后再修改；本地稿件已保留。')


def touch(project, actor):
    project.revision += 1
    project.updated_by = actor
    project.save()
    return project


def organization_for(actor, organization_id, manage=False, lock=False):
    if lock:
        # Account deactivation uses User -> Organization too. Lock the actor before
        # referencing it in create/update/archive FKs (including deferred checks).
        User.objects.select_for_update().get(pk=actor.pk)
    query = Organization.objects.select_for_update() if lock else Organization.objects
    org = query.get(pk=organization_id)
    role = require_access(actor, org, manage)
    return org, role


def read_project(actor, organization_id, project_id):
    org, role = organization_for(actor, organization_id)
    return Project.objects.select_related('updated_by', 'archived_by').get(pk=project_id, organization=org), role


@transaction.atomic
def create_project(actor, organization_id, *, name, description, media, source, style_imports=None, script=None):
    # Validate the bounded format input before taking the short database lock.
    name = text(name, 100, True)
    description = text(description, 2000)
    media = validate_media(media)
    document = empty_document() if source is None else parse_ass(source)
    org, _ = organization_for(actor, organization_id, manage=True, lock=True)
    if script is not None:
        if script != document['script']:
            validate_script(script)
        document['script'] = script
    document = import_initial_templates(actor, org.pk, document, [] if style_imports is None else style_imports)
    serialize_ass(document)
    return Project.objects.create(organization=org, name=name, description=description, media=media, document=document,
                                  created_by=actor, updated_by=actor)


@transaction.atomic
def update_project(actor, organization_id, project_id, revision, *, name, description):
    org, _ = organization_for(actor, organization_id, manage=True, lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    require_active(project)
    check_revision(project, revision)
    values = text(name, 100, True), text(description, 2000)
    if (project.name, project.description) == values:
        return project
    project.name, project.description = values
    return touch(project, actor)


@transaction.atomic
def set_archived(actor, organization_id, project_id, revision, *, archived):
    org, _ = organization_for(actor, organization_id, manage=True, lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    check_revision(project, revision)
    target = Project.Status.ARCHIVED if archived else Project.Status.ACTIVE
    if project.status == target:
        return project
    project.status = target
    project.archived_at = timezone.now() if archived else None
    project.archived_by = actor if archived else None
    return touch(project, actor)


@transaction.atomic
def save_document(actor, organization_id, project_id, revision, document):
    # Pure codec validates source, ids, styles, timing, text and final size bounds.
    serialize_ass(document)
    org, _ = organization_for(actor, organization_id, lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    require_active(project)
    check_revision(project, revision)
    validate_document_base(project, document)
    if project.document == document:
        return project
    project.document = document
    return touch(project, actor)


def validate_document_base(project, document):
    """Cue edits cannot smuggle changes to style IDs, source anchors or provenance."""
    serialize_ass(document)
    if any(document[key] != project.document[key] for key in ('source', 'styles', 'script')):
        raise ValidationError('不能替换项目 ASS 模板或样式定义；请使用样式管理操作。')


def split_cue(actor, organization_id, project_id, revision, document, cue_id, mode, position):
    # Compute/validate outside row locks; immutable DTO, no partial local writes.
    result = split_ass_document(document, cue_id, mode, position)
    # Reuse the only snapshot write path (permissions, lock order, CAS, template).
    project = save_document(actor, organization_id, project_id, revision, result['document'])
    return project, result
