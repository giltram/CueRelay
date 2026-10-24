"""Public account/settings operations. No organization dependency."""
from django.contrib.auth import update_session_auth_hash
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.views.decorators.debug import sensitive_variables
from .models import User, PersonalSettings, AudioDisplayMode
from .shortcuts import DEFAULTS, validate_overrides


def safe_user(user):
    return {'id': user.pk, 'username': user.username, 'is_dev': user.is_superuser}


def settings_for(user):
    row = PersonalSettings.objects.filter(user=user).first()
    return {'shortcut_overrides': row.shortcut_overrides if row else {},
            'audio_display_mode': row.audio_display_mode if row else AudioDisplayMode.SPECTRUM,
            'defaults': DEFAULTS}


def save_settings(user, changes):
    if not isinstance(changes, dict) or not changes or set(changes) - {'shortcut_overrides', 'audio_display_mode'}:
        raise ValidationError('仅接受快捷键或音频显示设置。')
    updates = {}
    if 'shortcut_overrides' in changes:
        updates['shortcut_overrides'] = validate_overrides(changes['shortcut_overrides'])
    if 'audio_display_mode' in changes:
        mode = changes['audio_display_mode']
        if not isinstance(mode, str) or mode not in AudioDisplayMode.values:
            raise ValidationError('音频显示模式必须是 waveform 或 spectrum。')
        updates['audio_display_mode'] = mode
    PersonalSettings.objects.update_or_create(user=user, defaults=updates)
    return settings_for(user)


@transaction.atomic
@sensitive_variables()
def change_password(request, old_password, new_password):
    if max(len(old_password), len(new_password)) > settings.ACCOUNT_PASSWORD_MAX_LENGTH:
        raise ValidationError('密码过长。')
    user = User.objects.select_for_update().get(pk=request.user.pk, is_active=True)
    if not user.check_password(old_password):
        raise ValidationError('旧密码不正确。')
    validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=['password'])
    update_session_auth_hash(request, user)
