"""Shared pure format errors; no dependency on parser or document operations."""


class AssError(ValueError):
    def __init__(self, message, line=None):
        self.issue = {"code": "unsupported_or_invalid_ass", "message": message}
        if line is not None:
            self.issue["line"] = line
        super().__init__(message)


def fail(message, line=None):
    raise AssError(message, line)
