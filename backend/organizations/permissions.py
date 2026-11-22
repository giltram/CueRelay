"""Fixed business capabilities. Membership/identity management is never configurable."""
import json
from pathlib import Path
from django.core.exceptions import ValidationError
from message_contracts import localized

DEFAULT_MEMBER_PERMISSIONS = json.loads((Path(__file__).resolve().parents[2] / 'shared/member-permissions.json').read_text())


def member_permissions(organization):
    return {**DEFAULT_MEMBER_PERMISSIONS, **organization.member_permissions}


def validate_permissions(value):
    if (not isinstance(value, dict) or set(value) != set(DEFAULT_MEMBER_PERMISSIONS)
            or any(type(item) is not bool for item in value.values())):
        raise ValidationError(localized('server.invalidMemberPermissions', '须提交全部14项权限，且每项只能为布尔值。', {}))
    return dict(value)


class PermissionConflict(Exception):
    pass
