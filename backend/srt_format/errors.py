"""SRT conversion issues, with physical line and one-based block locations."""
from message_contracts import localized


class SrtError(ValueError):
    def __init__(self, reason, message, *, line=None, block=None, **params):
        if block is not None:
            params['block'] = block
            message = '字幕块 {{block}}：' + message
        value = localized(reason, message, params)
        self.issue = {'code': 'unsupported_or_invalid_srt', 'message': value,
                      'reason': reason, 'params': params}
        if line is not None:
            self.issue['line'] = line
        if block is not None:
            self.issue['block'] = block
        super().__init__(value)
