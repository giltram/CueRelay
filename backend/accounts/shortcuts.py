"""Physical KeyboardEvent.code bindings; shared defaults are the sole authority."""
import json
import re
from pathlib import Path
from django.core.exceptions import ValidationError

DEFAULTS = json.loads((Path(__file__).resolve().parents[2] / 'shared/timing-shortcuts.json').read_text())
# Deliberately small portable subset. Ctrl/Meta/Alt are reserved for OS/browser use.
BINDING = re.compile(r'^(Shift\+)?(Key[A-Z]|Digit[0-9]|Enter|NumpadEnter|Space)$')


def validate_overrides(value):
    if not isinstance(value, dict) or set(value) - DEFAULTS.keys():
        raise ValidationError('未知快捷键动作。')
    normalized = {}
    for action, bindings in value.items():
        if not isinstance(bindings, list) or len(bindings) > 4:
            raise ValidationError('每个动作接受 0–4 个绑定；空列表表示禁用。')
        for binding in bindings:
            if not isinstance(binding, str) or not BINDING.fullmatch(binding) or binding.startswith(('Shift+Enter', 'Shift+NumpadEnter', 'Shift+Space')):
                raise ValidationError('仅支持字母、数字、Enter、Space，以及 Shift+字母/数字；其他组合为保留键。')
        if bindings != DEFAULTS[action]['bindings']:
            normalized[action] = bindings
    used = set()
    for action, default in DEFAULTS.items():
        for binding in normalized.get(action, default['bindings']):
            if binding in used:
                raise ValidationError(f'快捷键冲突：{binding}')
            used.add(binding)
    return normalized
