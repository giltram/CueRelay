"""Disposable local/CI tests only; never load .env or use production PG* values.

Use --settings=application.test_settings with Django's test command. A dedicated
PostgreSQL cluster must expose role cuerelay_test on loopback (default 55433).
The role needs CREATEDB; Django owns creation/destruction of its unique test DB.
"""
import os

# Base settings require a key at import time, including in a clean clone.
os.environ.setdefault('DJANGO_SECRET_KEY', 'cuerelay-disposable-tests-only')
from .settings import *  # noqa: F403

SECRET_KEY = 'cuerelay-disposable-tests-only'
DEBUG = True
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'testserver']
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
CSRF_TRUSTED_ORIGINS = ['http://127.0.0.1:5199']
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': 'postgres',  # Maintenance DB only; never migrate or serve this DB.
    'USER': 'cuerelay_test',
    'PASSWORD': 'cuerelay-test-only',
    'HOST': '127.0.0.1',
    'PORT': os.environ.get('CUERELAY_TEST_PGPORT', '55433'),
    'TEST': {'NAME': f'test_cuerelay_{os.getpid()}'},
    'OPTIONS': {'sslmode': 'disable'},
}}
# Do not inherit a development/production diagnostic file handler.
LOGGING['handlers']['diagnostic'] = {  # noqa: F405
    'class': 'logging.StreamHandler', 'formatter': 'diagnostic_json',
}
