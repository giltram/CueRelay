"""Supported writes: lock target User first, then Organization; never the reverse.

The organization row serializes membership changes and account deactivation checks.
No signals, global roles, or cross-organization authority inherited from staff.
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from accounts.models import User
from .models import Organization, OrganizationMembership as Membership


def require_access(actor, organization, manage=False):
    # Re-read identity and membership on each operation, including under write lock.
    actor = User.objects.get(pk=actor.pk)
    if not actor.is_active:
        raise PermissionDenied
    role = Membership.objects.filter(organization=organization, user=actor).values_list('role', flat=True).first()
    if not actor.is_superuser and (not role or (manage and role != 'organizer')):
        raise PermissionDenied
    return role


def ensure_organizer(organization):
    if not Membership.objects.filter(organization=organization, role='organizer', user__is_active=True).exists():
        raise ValidationError('组织必须至少保留一名活动 organizer。')


def validate_name(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise ValidationError('组织名须为 1–100 个字符。')
    return name.strip()


@transaction.atomic
def create_organization(name, initial_user_id):
    user = User.objects.select_for_update().get(pk=initial_user_id)
    if not user.is_active:
        raise ValidationError('初始 organizer 必须是活动账号。')
    organization = Organization.objects.create(name=validate_name(name))
    Membership.objects.create(organization=organization, user=user, role='organizer')
    return organization


@transaction.atomic
def rename_organization(actor, organization_id, name):
    org = Organization.objects.select_for_update().get(pk=organization_id)
    require_access(actor, org, manage=True)
    org.name = validate_name(name)
    org.save(update_fields=['name'])
    return org


@transaction.atomic
def add_member(actor, organization_id, username):
    try:
        user = User.objects.select_for_update().get(username=username, is_active=True)
    except User.DoesNotExist:
        raise ValidationError('未找到可添加的活动账号。')
    org = Organization.objects.select_for_update().get(pk=organization_id)
    require_access(actor, org, manage=True)
    if Membership.objects.filter(organization=org, user=user).exists():
        raise ValidationError('该账号已在组织中。')
    return Membership.objects.create(organization=org, user=user, role='member')


@transaction.atomic
def change_member(actor, organization_id, membership_id=None, *, role=None, leave=False):
    query = Membership.objects.filter(organization_id=organization_id)
    target = query.get(user=actor) if leave else query.get(pk=membership_id)
    User.objects.select_for_update().get(pk=target.user_id)
    org = Organization.objects.select_for_update().get(pk=organization_id)
    actor = User.objects.get(pk=actor.pk)
    require_access(actor, org, manage=not leave)
    target = Membership.objects.get(pk=target.pk, organization=org)
    # Protect peers, including against demote-then-remove. Recheck under the org lock.
    if not actor.is_superuser and target.role == 'organizer' and target.user_id != actor.pk:
        raise PermissionDenied('organizer 不能移除或降级其他 organizer。')
    if role is None:
        target.delete()
    else:
        if role not in Membership.Role.values:
            raise ValidationError('无效的组织角色。')
        target.role = role
        target.save(update_fields=['role'])
    ensure_organizer(org)
    return target


def lock_user_organizations(user):
    """Upper-level coordinator must already hold the target user's row lock."""
    ids = Membership.objects.filter(user=user).values_list('organization_id', flat=True)
    return list(Organization.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
