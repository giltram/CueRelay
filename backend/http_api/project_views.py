"""Protected project JSON adapters; never accept videos or organization overrides."""
from message_contracts import localized
from functools import wraps
from django.core.exceptions import ValidationError
from ass_format import AssError
from srt_format import SrtError
from projects.reference_services import reference_data, replace_reference
from projects import services
from projects.models import Project
from organizations.services import effective_permissions
from organizations.style_templates import TemplateConflict
from .identity_views import endpoint, error, payload


def project_endpoint(methods):
    def decorate(function):
        @endpoint(methods)
        @wraps(function)
        def view(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except services.ProjectConflict as failure:
                return error(failure.code, failure.message, 409)
            except SrtError as failure:
                return error('invalid_srt', failure.issue['message'], 422, details=[failure.issue])
            except AssError as failure:
                return error('invalid_ass', failure.issue['message'], 422)
            except TemplateConflict as failure:
                return error('template_conflict', failure.args[0], 409)
        return view
    return decorate


def person(user):
    return {'username': user.username} if user else None


def project_data(project, detail=False):
    data = {
        'id': project.pk, 'organization_id': project.organization_id, 'name': project.name,
        'description': project.description, 'status': project.status, 'revision': project.revision,
        'created_at': project.created_at.isoformat(), 'updated_at': project.updated_at.isoformat(),
        'updated_by': person(project.updated_by),
        'archived_at': project.archived_at.isoformat() if project.archived_at else None,
        'archived_by': person(project.archived_by),
    }
    if detail:
        data.update(media=project.media, document=project.document, reference=reference_data(project))
    return data


@project_endpoint(['GET', 'POST'])
def project_list(request, organization_id):
    org, _ = services.organization_for(request.user, organization_id, permission='create_project' if request.method == 'POST' else None)
    if request.method == 'POST':
        data = payload(request, ['name', 'description', 'media', 'source', 'style_imports', 'script', 'reference_source'], partial=True)
        if not {'name', 'description', 'media', 'source'} <= set(data):
            raise ValidationError(localized('server.creatingAProjectRequiresNameDescriptionMediaAndSource', '创建项目需要 name、description、media、source。', {}))
        project = services.create_project(request.user, org.pk, **data)
        return {'project': {**project_data(project, True), 'effective_permissions': effective_permissions(request.user, project.organization)}}
    if set(request.GET) - {'status', 'search', 'page'}:
        raise ValidationError(localized('server.unknownListParameter', '未知的列表参数。', {}))
    status = request.GET.get('status', 'active')
    if status not in Project.Status.values:
        raise ValidationError(localized('server.invalidProjectStatus', '无效的项目状态。', {}))
    search = services.text(request.GET.get('search', ''), 100)
    try:
        page = int(request.GET.get('page', '1'))
        if not 1 <= page <= 1_000_000:
            raise ValueError
    except ValueError:
        raise ValidationError(localized('server.invalidPageNumber', '页码无效。', {}))
    query = Project.objects.filter(organization=org, status=status, name__icontains=search).select_related('updated_by', 'archived_by')
    order = '-archived_at' if status == Project.Status.ARCHIVED else '-updated_at'
    query = query.order_by(order, '-id')
    total = query.count()
    rows = query[(page - 1) * 25:page * 25]
    return {'projects': [project_data(row) for row in rows], 'total': total, 'page': page, 'has_more': page * 25 < total}


@project_endpoint(['GET', 'PATCH'])
def project_detail(request, organization_id, project_id):
    if request.method == 'PATCH':
        data = payload(request, ['name', 'description', 'revision'])
        project = services.update_project(request.user, organization_id, project_id, **data)
    else:
        project, _ = services.read_project(request.user, organization_id, project_id)
    return {'project': {**project_data(project, True), 'effective_permissions': effective_permissions(request.user, project.organization)}}


@project_endpoint(['POST'])
def archive(request, organization_id, project_id):
    data = payload(request, ['revision'])
    project = services.set_archived(request.user, organization_id, project_id, data['revision'], archived=True)
    return {'project': project_data(project)}


@project_endpoint(['POST'])
def restore(request, organization_id, project_id):
    data = payload(request, ['revision'])
    project = services.set_archived(request.user, organization_id, project_id, data['revision'], archived=False)
    return {'project': project_data(project)}


@project_endpoint(['PUT'])
def document(request, organization_id, project_id):
    data = payload(request, ['revision', 'document'])
    project = services.save_document(request.user, organization_id, project_id, **data)
    return {'project': project_data(project)}


@project_endpoint(['POST'])
def split_cue(request, organization_id, project_id):
    data = payload(request, ['revision', 'document', 'cue_id', 'mode', 'position'])
    project, result = services.split_cue(request.user, organization_id, project_id, **data)
    return {**result, 'project': project_data(project)}


@project_endpoint(['PUT'])
def reference(request, organization_id, project_id):
    # Check access before parsing, then reauthorize under the write lock.
    services.organization_for(request.user, organization_id, permission='edit_project')
    data = payload(request, ['version', 'source'])
    return {'reference': replace_reference(request.user, organization_id, project_id, **data)}
