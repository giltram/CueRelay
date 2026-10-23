"""Bound storage for arbitrary unknown account keys without resetting live limits."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from accounts.models import LoginAttempt


class Command(BaseCommand):
    help = 'Delete login attempt state inactive for at least 24 hours (run daily).'

    def handle(self, *args, **options):
        retention = max(86400, settings.LOGIN_FAILURE_WINDOW_SECONDS, settings.LOGIN_COOLOFF_SECONDS)
        cutoff = timezone.now() - timedelta(seconds=retention)
        count, _ = LoginAttempt.objects.filter(updated_at__lt=cutoff).delete()
        self.stdout.write(f'Deleted {count} expired login attempt records.')
