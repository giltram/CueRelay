"""Session/CSRF JSON adapters for the public project glossary services."""
from functools import wraps
from django.core.exceptions import ValidationError
from glossary.services import GlossaryConflict
from projects import glossary_services as services
from .identity_views import error, payload
from .project_views import project_endpoint


def glossary_endpoint(methods):
    def decorate(function):
        @project_endpoint(methods)
        @wraps(function)
        def view(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except GlossaryConflict as failure:
                return error(failure.code, failure.message, 409)
        return view
    return decorate


def query(request):
    if set(request.GET) - {'search', 'page'}:
        raise ValidationError('未知的查询参数。')
    try:
        page = int(request.GET.get('page', '1'))
    except ValueError:
        raise ValidationError('页码无效。')
    return {'search': request.GET.get('search', ''), 'page': page}


@glossary_endpoint(['GET', 'POST', 'PUT'])
def project_glossary(request, organization_id, project_id):
    if request.method == 'GET':
        return services.read_context(request.user, organization_id, project_id, **query(request))
    if request.method == 'POST':
        data = payload(request, ['association_version', 'glossary_id', 'original', 'translation', 'note'])
        return services.save_entry(request.user, organization_id, project_id, **data)
    data = payload(request, ['association_version', 'glossary_id', 'fork', 'use_organization_default'], partial=True)
    if not {'association_version', 'glossary_id'} <= set(data):
        raise ValidationError('需要关联版本和当前表 ID。')
    return services.change_association(request.user, organization_id, project_id, **data)


@glossary_endpoint(['GET', 'PUT'])
def entry(request, organization_id, project_id, table_id, entry_id):
    if request.method == 'GET':
        return {'entry': services.read_entry(request.user, organization_id, project_id, table_id, entry_id)}
    data = payload(request, ['association_version', 'glossary_id', 'original', 'translation', 'note', 'revision'])
    if data['glossary_id'] != str(table_id):
        raise ValidationError('词条所属表与请求路径不一致。')
    return services.save_entry(request.user, organization_id, project_id, entry_id=entry_id, **data)


@glossary_endpoint(['GET', 'POST'])
def organization_glossary(request, organization_id):
    if request.method == 'GET':
        return services.read_organization_context(request.user, organization_id, **query(request))
    data = payload(request, ['association_version', 'glossary_id', 'original', 'translation', 'note'])
    return services.save_organization_entry(request.user, organization_id, **data)


@glossary_endpoint(['GET', 'PUT'])
def organization_entry(request, organization_id, table_id, entry_id):
    if request.method == 'GET':
        return {'entry': services.read_organization_entry(request.user, organization_id, table_id, entry_id)}
    data = payload(request, ['association_version', 'glossary_id', 'original', 'translation', 'note', 'revision'])
    if data['glossary_id'] != str(table_id):
        raise ValidationError('词条所属表与请求路径不一致。')
    return services.save_organization_entry(request.user, organization_id, entry_id=entry_id, **data)
