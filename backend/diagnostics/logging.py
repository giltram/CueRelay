"""JSON lines with no raw Django messages, URLs, locals or exception values."""
import json
import logging
from datetime import datetime, timezone
from .middleware import exception_fields


class SafeJsonFormatter(logging.Formatter):
    def format(self, record):
        fields = record.msg if isinstance(record.msg, dict) and record.name == 'cuerelay.diagnostics' else {'event': 'framework_error', 'logger': record.name}
        request = getattr(record, 'request', None)
        if request is not None and hasattr(request, 'diagnostic_request_id'):
            fields = {**fields, 'request_id': request.diagnostic_request_id}
        if record.exc_info and record.exc_info[1]:
            fields = {**fields, 'exception': exception_fields(record.exc_info[1])}
        return json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(), **fields}, ensure_ascii=False)
