"""Public account/settings operations. No organization dependency."""
from message_contracts import localized
from django.contrib.auth import update_session_auth_hash
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.views.decorators.debug import sensitive_variables
from .models import User, PersonalSettings, AudioDisplayMode
import json
from pathlib import Path
LANGUAGES = json.loads((Path(__file__).resolve().parents[2] / 'shared/languages.json').read_text())

from .shortcuts import DEFAULTS, validate_overrides


def safe_user(user):
    return {'id': user.pk, 'username': user.username, 'is_dev': user.is_superuser}


def settings_for(user):
    row = PersonalSettings.objects.filter(user=user).first()
    return {'language_preference': row.language_preference if row else 'system',
            'handbook_seen': user.handbook_seen,
            'shortcut_overrides': row.shortcut_overrides if row else {},
            'audio_display_mode': row.audio_display_mode if row else AudioDisplayMode.SPECTRUM,
            'mouse_sets_cue_boundary': row.mouse_sets_cue_boundary if row else True,
            'defaults': DEFAULTS}


def acknowledge_handbook(user):
    User.objects.filter(pk=user.pk).update(handbook_seen=True)
    return {'handbook_seen': True}


def save_settings(user, changes):
    if not isinstance(changes, dict) or not changes or set(changes) - {'shortcut_overrides', 'audio_display_mode', 'mouse_sets_cue_boundary', 'language_preference'}:
        raise ValidationError(localized('server.onlyShortcutAudioDisplayMouseBoundaryAndLanguageSettings', '仅接受快捷键、音频显示或鼠标边界设置。', {}))
    updates = {}
    if 'language_preference' in changes:
        preference = changes['language_preference']
        if not isinstance(preference, str) or preference not in {'system', *LANGUAGES}:
            raise ValidationError(localized('server.invalidLanguagePreference', '不支持此语言偏好。'))
        updates['language_preference'] = preference
    if 'shortcut_overrides' in changes:
        updates['shortcut_overrides'] = validate_overrides(changes['shortcut_overrides'])
    if 'audio_display_mode' in changes:
        mode = changes['audio_display_mode']
        if not isinstance(mode, str) or mode not in AudioDisplayMode.values:
            raise ValidationError(localized('server.audioDisplayModeMustBeWaveformOrSpectrum', '音频显示模式必须是 waveform 或 spectrum。', {}))
        updates['audio_display_mode'] = mode
    if 'mouse_sets_cue_boundary' in changes:
        if type(changes['mouse_sets_cue_boundary']) is not bool:
            raise ValidationError(localized('server.theMouseBoundarySettingMustBeABoolean', '鼠标边界设置必须是布尔值。', {}))
        updates['mouse_sets_cue_boundary'] = changes['mouse_sets_cue_boundary']
    PersonalSettings.objects.update_or_create(user=user, defaults=updates)
    return settings_for(user)


@transaction.atomic
@sensitive_variables()
def change_password(request, old_password, new_password):
    if max(len(old_password), len(new_password)) > settings.ACCOUNT_PASSWORD_MAX_LENGTH:
        raise ValidationError(localized('server.passwordIsTooLong', '密码过长。', {}))
    user = User.objects.select_for_update().get(pk=request.user.pk, is_active=True)
    if not user.check_password(old_password):
        raise ValidationError(localized('server.theCurrentPasswordIsIncorrect', '旧密码不正确。', {}))
    validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=['password'])
    update_session_auth_hash(request, user)
