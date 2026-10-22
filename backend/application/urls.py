from django.urls import path
from http_api.ass_views import import_ass, export_ass, empty_document

urlpatterns = [
    path("api/ass/empty", empty_document),
    path("api/ass/import", import_ass),
    path("api/ass/export", export_ass),
]
