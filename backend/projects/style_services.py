"""Style commands share project snapshot validation, lock order, CAS and touch."""
from message_contracts import localized
from django.db import transaction
from django.core.exceptions import ValidationError
from ass_format import apply_style_operation
from .models import Project
from organizations.services import require_permission
from .services import organization_for, require_active, check_revision, touch, validate_document_base
from .document_styles import import_templates


@transaction.atomic
def change_styles(actor, organization_id, project_id, revision, document, operation):
    org, _ = organization_for(actor, organization_id, lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    require_active(project); check_revision(project, revision)
    validate_document_base(project, document)
    # The supplied complete snapshot may contain local edits. Authorize those
    # against the locked authoritative snapshot, independently of the command.
    if document['cues'] != project.document['cues']:
        require_permission(actor, org, 'edit_subtitles')
    kind = operation.get('type') if isinstance(operation, dict) else None
    if kind == 'assign':
        require_permission(actor, org, 'edit_subtitles')
    else:
        require_permission(actor, org, 'manage_project_styles')
    if isinstance(operation, dict) and operation.get('type') == 'import':
        updated = import_templates(actor, org.pk, document, [operation])
    elif isinstance(operation, dict) and operation.get('type') == 'import_many':
        if set(operation) != {'type', 'imports'} or not operation['imports']:
            raise ValidationError(localized('server.batchImportRequiresANonEmptyTemplateList', '批量导入须提供非空模板列表。', {}))
        updated = import_templates(actor, org.pk, document, operation['imports'])
    else:
        updated = apply_style_operation(document, operation)
    if updated['cues'] != document['cues']:
        require_permission(actor, org, 'edit_subtitles')
    if updated != project.document:
        project.document = updated
        touch(project, actor)
    return project
