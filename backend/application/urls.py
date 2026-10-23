from django.contrib import admin
from django.urls import path
from http_api.ass_views import import_ass, export_ass, empty_document
from http_api import identity_views as identity

urlpatterns = [
    path('admin/', admin.site.urls),
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
