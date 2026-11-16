from message_contracts import localized
from django.conf import settings
from django.core.exceptions import ValidationError


class MaximumLengthValidator:
    def validate(self, password, user=None):
        if len(password) > settings.ACCOUNT_PASSWORD_MAX_LENGTH:
            raise ValidationError(self.get_help_text(), code='password_too_long')

    def get_help_text(self):
        return localized('server.passwordsMustNotExceedValueCharacters', '密码不能超过 {{v0}} 个字符。', {'v0': settings.ACCOUNT_PASSWORD_MAX_LENGTH})
