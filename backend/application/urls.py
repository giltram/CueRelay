from django.contrib import admin
from django.urls import path
from http_api.ass_views import import_ass, export_ass, empty_document, split_ass, local_styles
from http_api import identity_views as identity
from http_api import project_views as projects
from http_api import style_views as styles

urlpatterns = [
    path('api/ass/styles', local_styles),
    path('api/organizations/<int:organization_id>/style-templates', styles.templates),
    path('api/organizations/<int:organization_id>/style-templates/<uuid:template_id>', styles.template_detail),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>/styles', styles.project_styles),
    path('admin/', admin.site.urls),
    path('api/organizations/<int:organization_id>/projects', projects.project_list),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>', projects.project_detail),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>/archive', projects.archive),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>/restore', projects.restore),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>/document', projects.document),
    path('api/organizations/<int:organization_id>/projects/<int:project_id>/split', projects.split_cue),
    path('api/ass/split', split_ass),
    path('api/ass/empty', empty_document),
    path('api/ass/import', import_ass),
    path('api/ass/export', export_ass),
    path('api/auth/session', identity.session),
    path('api/auth/login', identity.sign_in),
    path('api/auth/logout', identity.sign_out),
    path('api/auth/me', identity.me),
    path('api/auth/password', identity.password),
    path('api/me/settings', identity.personal_settings),
    path('api/organizations', identity.organization_list),
    path('api/organizations/<int:organization_id>', identity.organization_detail),
    path('api/organizations/<int:organization_id>/members', identity.members),
    path('api/organizations/<int:organization_id>/members/<int:membership_id>', identity.member),
    path('api/organizations/<int:organization_id>/leave', identity.leave),
]
