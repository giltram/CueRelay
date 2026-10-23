"""Composition root. Set environment before starting Django (see .env.example)."""
import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    raise ImproperlyConfigured('Set DJANGO_SECRET_KEY; see .env.example')
DEBUG = os.environ.get('DJANGO_DEBUG', '0') == '1'
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
ROOT_URLCONF = 'application.urls'
ASGI_APPLICATION = 'application.asgi.application'
AUTH_USER_MODEL = 'accounts.User'
INSTALLED_APPS = [
    'django.contrib.admin', 'django.contrib.auth', 'django.contrib.contenttypes',
    'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles',
    'rest_framework', 'accounts', 'organizations', 'application.apps.ApplicationConfig',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.contrib.messages.middleware.MessageMiddleware',
]
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': os.environ.get('PGDATABASE', 'cuerelay'),
    'USER': os.environ.get('PGUSER', 'cuerelay'),
    'PASSWORD': os.environ.get('PGPASSWORD', ''),
    'HOST': os.environ.get('PGHOST', '127.0.0.1'),
    'PORT': os.environ.get('PGPORT', '5432'),
    'OPTIONS': {'sslmode': os.environ.get('PGSSLMODE', 'prefer')},
}}
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'APP_DIRS': True,
              'OPTIONS': {'context_processors': [
                  'django.template.context_processors.request', 'django.contrib.auth.context_processors.auth',
                  'django.contrib.messages.context_processors.messages']}}]
STATIC_URL = '/static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
SESSION_ENGINE = 'django.contrib.sessions.backends.db'
SESSION_COOKIE_AGE = 7 * 24 * 60 * 60
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_FAILURE_VIEW = 'http_api.identity_views.csrf_failure'
CSRF_TRUSTED_ORIGINS = [v for v in os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',') if v]
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
DATA_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}
