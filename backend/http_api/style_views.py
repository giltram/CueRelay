"""Style adapters. All identity, CSRF, object scope and version checks stay server-side."""
from functools import wraps
from django.core.exceptions import ValidationError
from ass_format import AssError, style_usage
from organizations import style_templates
from projects.style_services import change_styles
from .identity_views import endpoint, payload, error
from .project_views import project_endpoint, project_data


def template_endpoint(methods):
    def decorate(function):
        @endpoint(methods)
        @wraps(function)
        def view(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except style_templates.TemplateConflict as failure:
                return error('template_conflict', str(failure), 409)
            except AssError as failure:
                return error('invalid_style', failure.issue['message'], 422)
        return view
    return decorate


@template_endpoint(['GET', 'POST'])
def templates(request, organization_id):
    if request.method == 'GET':
        if request.GET:
            raise ValidationError('模板列表不接受查询参数。')
        return {'templates': style_templates.list_templates(request.user, organization_id)}
    data = payload(request, ['name', 'fields', 'reference', 'source_label'])
    return {'template': style_templates.create_template(request.user, organization_id, **data)}


@template_endpoint(['PUT', 'DELETE'])
def template_detail(request, organization_id, template_id):
    if request.method == 'DELETE':
        data = payload(request, ['revision'])
        style_templates.delete_template(request.user, organization_id, template_id, **data)
        return {'deleted': str(template_id)}
    data = payload(request, ['revision', 'name', 'fields', 'reference', 'source_label'])
    return {'template': style_templates.update_template(request.user, organization_id, template_id, **data)}


@project_endpoint(['POST'])
def project_styles(request, organization_id, project_id):
    data = payload(request, ['revision', 'document', 'operation'])
    try:
        project = change_styles(request.user, organization_id, project_id, **data)
    except style_templates.TemplateConflict as failure:
        return error('template_conflict', str(failure), 409)
    return {'document': project.document, 'project': project_data(project), 'usage': style_usage(project.document)}

