"""Style commands share project snapshot validation, lock order, CAS and touch."""
from django.db import transaction
from ass_format import apply_style_operation
from .models import Project
from .services import organization_for, require_active, check_revision, touch, validate_document_base
from .document_styles import import_template


@transaction.atomic
def change_styles(actor, organization_id, project_id, revision, document, operation):
    org, _ = organization_for(actor, organization_id, lock=True)
    project = Project.objects.select_for_update().get(pk=project_id, organization=org)
    require_active(project); check_revision(project, revision)
    validate_document_base(project, document)
    if isinstance(operation, dict) and operation.get('type') == 'import':
        updated = import_template(actor, org.pk, document, operation)
    else:
        updated = apply_style_operation(document, operation)
    if updated != project.document:
        project.document = updated
        touch(project, actor)
    return project
