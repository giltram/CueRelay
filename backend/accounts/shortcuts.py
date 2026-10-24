"""Physical KeyboardEvent.code bindings; shared defaults are the sole authority."""
import json
import re
from pathlib import Path
from django.core.exceptions import ValidationError

DEFAULTS = json.loads((Path(__file__).resolve().parents[2] / 'shared/timing-shortcuts.json').read_text())
# Ctrl/Meta deletion aliases are supported only for the delete-row action.
BINDING = re.compile(r'^(Key[A-Z]|Digit[0-9]|Enter|NumpadEnter|Space|Shift\+(Key[A-Z]|Digit[0-9]))$')
DELETION_BINDING = re.compile(r'^(Ctrl|Meta)\+(Delete|Backspace)$')


def validate_overrides(value):
    if not isinstance(value, dict) or set(value) - DEFAULTS.keys():
        raise ValidationError('未知快捷键动作。')
    normalized = {}
    for action, bindings in value.items():
        if not isinstance(bindings, list) or len(bindings) > 4:
            raise ValidationError('每个动作接受 0–4 个绑定；空列表表示禁用。')
        for binding in bindings:
            if not isinstance(binding, str) or not (BINDING.fullmatch(binding) or action == 'delete-row' and DELETION_BINDING.fullmatch(binding)):
                raise ValidationError('快捷键格式不正确。请使用英文逗号（,）分隔多个绑定，不能使用中文逗号（，）；检查键码（key）及大小写，例如 KeyG、Digit1、Shift+KeyT。也可使用“录制”按钮；仍无法录入请联系 dev。')
        if bindings != DEFAULTS[action]['bindings']:
            normalized[action] = bindings
    used = set()
    for action, default in DEFAULTS.items():
        for binding in normalized.get(action, default['bindings']):
            if binding in used:
                raise ValidationError(f'快捷键冲突：{binding}')
            used.add(binding)
    return normalized
