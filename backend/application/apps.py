from django.apps import AppConfig


class ApplicationConfig(AppConfig):
    name = 'application'

    def ready(self):
        from . import admin  # Explicit composition-root registration, no signals.
