"""Explicit cross-module account lifecycle coordination (Admin's only user writer)."""
from django.db import transaction
from accounts.models import User
from organizations.services import lock_user_organizations, ensure_organizer


@transaction.atomic
def save_account(user):
    if user.pk:
        User.objects.select_for_update().get(pk=user.pk)
        organizations = lock_user_organizations(user)
        user.save()
        for org in organizations:
            ensure_organizer(org)
    else:
        user.save()
