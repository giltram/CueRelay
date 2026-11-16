"""Locale-free message metadata. No Django, HTTP, or application dependencies."""


class Message(str):
    """Keep the existing Chinese str contract alongside stable presentation metadata."""
    def __new__(cls, reason, text, params=None):
        params = dict(params or {})
        for key, value in params.items():
            text = text.replace('{{' + key + '}}', str(value))
        instance = super().__new__(cls, text)
        instance.reason = reason
        instance.params = params
        return instance


def localized(reason, text, params=None):
    return Message(reason, text, params)


def wire_messages(value):
    """Add metadata without removing or renaming any existing protocol fields."""
    if isinstance(value, dict):
        result = {key: wire_messages(item) for key, item in value.items()}
        message = value.get('message')
        if isinstance(message, Message):
            result.update(reason=message.reason, params=message.params)
        return result
    if isinstance(value, (list, tuple)):
        return [wire_messages(item) for item in value]
    return value
