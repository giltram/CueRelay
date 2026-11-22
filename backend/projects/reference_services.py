"""Project reference writes have their own CAS, independent of document revision."""
from django.core.exceptions import ValidationError
from django.db import transaction
from message_contracts import localized
from srt_format import parse_reference_srt
from .models import Project
from .services import ProjectConflict, organization_for, require_active


def reference_data(project):
    return {'version': project.reference_version, 'cues': project.reference_cues}


@transaction.atomic
def replace_reference(actor, organization_id, project_id, *, version, source):
    cues = None if source is None else parse_reference_srt(source)
    org, _ = organization_for(actor, organization_id, permission='edit_project', lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    require_active(project)
    if type(version) is not int or version < 1:
        raise ValidationError(localized('reference.invalidVersion', '参考版本必须为正整数。', {}))
    if version != project.reference_version:
        raise ProjectConflict('reference_conflict', localized('reference.conflict', '参考字幕已变化。请刷新项目版本后重试，当前输入已保留。', {}))
    if project.reference_cues != cues:
        project.reference_cues = cues
        project.reference_version += 1
        project.save(update_fields=['reference_cues', 'reference_version'])
    return reference_data(project)
