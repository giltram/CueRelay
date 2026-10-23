"""Protected project JSON adapters; never accept videos or organization overrides."""
from functools import wraps
from django.core.exceptions import ValidationError
from ass_format import AssError
from projects import services
from projects.models import Project
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
            except AssError as failure:
                return error('invalid_ass', failure.issue['message'], 422)
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
        data.update(media=project.media, document=project.document)
    return data


@project_endpoint(['GET', 'POST'])
def project_list(request, organization_id):
    org, _ = services.organization_for(request.user, organization_id, manage=request.method == 'POST')
    if request.method == 'POST':
        data = payload(request, ['name', 'description', 'media', 'source'])
        project = services.create_project(request.user, org.pk, **data)
        return {'project': project_data(project, True)}
    if set(request.GET) - {'status', 'search', 'page'}:
        raise ValidationError('未知的列表参数。')
    status = request.GET.get('status', 'active')
    if status not in Project.Status.values:
        raise ValidationError('无效的项目状态。')
    search = services.text(request.GET.get('search', ''), 100)
    try:
        page = int(request.GET.get('page', '1'))
        if not 1 <= page <= 1_000_000:
            raise ValueError
    except ValueError:
        raise ValidationError('页码无效。')
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
    return {'project': project_data(project, True)}


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
