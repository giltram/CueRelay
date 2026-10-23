"""Account login protection shared by every Django authenticate entry point.

PostgreSQL only: hold one account row lock through password verification and
failure accounting. Unknown usernames use the same path and bounded state.
"""
import hashlib
import logging
import math
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables
from .models import LoginAttempt, User

logger = logging.getLogger('accounts.security')


class AccountBackend(ModelBackend):
    @sensitive_variables()
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not isinstance(username, str) or not isinstance(password, str):
            raise PermissionDenied
        if len(username) > 150 or len(password) > settings.ACCOUNT_PASSWORD_MAX_LENGTH:
            raise PermissionDenied
        username = User.normalize_username(username.strip())
        if not username or len(username) > 150 or '\0' in username:
            raise PermissionDenied
        try:
            account_key = hashlib.sha256(username.encode()).hexdigest()
            password.encode()
        except UnicodeError:
            raise PermissionDenied
        user = self._attempt(request, username, password, account_key)
        if user is None:
            # Raise AFTER committing failure state; also stop the legacy backend.
            raise PermissionDenied
        return user

    @sensitive_variables()
    def _attempt(self, request, username, password, account_key):
        with transaction.atomic():
            attempt, _ = LoginAttempt.objects.select_for_update().get_or_create(account_key=account_key)
            # Read the clock after acquiring the lock (another worker may wait).
            now = timezone.now()
            if attempt.locked_until and attempt.locked_until > now:
                self._limited(request, attempt.locked_until, now)
                return None
            if attempt.locked_until:
                attempt.failure_times = []
                attempt.locked_until = None
            user = super().authenticate(request, username=username, password=password)
            if user is not None:
                attempt.failure_times = []
                logger.info('login_succeeded account=%s', account_key)
            else:
                # Start the cooldown after the expensive check has completed.
                now = timezone.now()
                cutoff = now.timestamp() - settings.LOGIN_FAILURE_WINDOW_SECONDS
                attempt.failure_times = [stamp for stamp in attempt.failure_times if stamp > cutoff]
                attempt.failure_times.append(now.timestamp())
                logger.info('login_failed account=%s', account_key)
                if len(attempt.failure_times) >= settings.LOGIN_FAILURE_LIMIT:
                    attempt.locked_until = now + timedelta(seconds=settings.LOGIN_COOLOFF_SECONDS)
                    self._limited(request, attempt.locked_until, now)
                    logger.warning('login_limited account=%s', account_key)
            attempt.save(update_fields=['failure_times', 'locked_until', 'updated_at'])
            return user

    @staticmethod
    def _limited(request, locked_until, now):
        if request is not None:
            request.login_retry_after = max(1, math.ceil((locked_until - now).total_seconds()))

    async def aauthenticate(self, request, username=None, password=None, **kwargs):
        # ModelBackend has its own async implementation; explicitly route it
        # through the same transaction rather than inheriting an unguarded path.
        return await sync_to_async(self.authenticate, thread_sensitive=True)(
            request, username=username, password=password, **kwargs,
        )
