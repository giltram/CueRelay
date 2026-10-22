"""Local conversion workbench only. No database, sessions or business storage."""

SECRET_KEY = "local-conversion-workbench-not-for-deployment"
DEBUG = False
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
ROOT_URLCONF = "application.urls"
ASGI_APPLICATION = "application.asgi.application"
INSTALLED_APPS = ["rest_framework"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
DATABASES = {}
USE_TZ = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
}
