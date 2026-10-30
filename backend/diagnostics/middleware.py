"""Outermost request correlation, including CSRF and short-circuit responses."""
import logging
import re
import time
import traceback
import uuid
from pathlib import Path
from django.conf import settings
from django.core.exceptions import PermissionDenied, SuspiciousOperation, BadRequest
from django.http import Http404

logger = logging.getLogger('cuerelay.diagnostics')


def request_id(value):
    # A trace identifier is untrusted metadata, never identity or idempotency.
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        return str(uuid.uuid4())


def exception_fields(error):
    root = Path(__file__).resolve().parent.parent
    frames = []
    for frame in traceback.extract_tb(error.__traceback__)[-12:]:
        try:
            source = str(Path(frame.filename).relative_to(root))
        except ValueError:
            source = 'dependency'
        frames.append(f'{source}:{frame.lineno}')
    return {'type': type(error).__name__ if re.fullmatch(r'[A-Za-z]{1,60}', type(error).__name__) else 'Error', 'stack': frames}


def emit(fields):
    try:
        logger.info(fields)
    except Exception:
        # Diagnostics and disk quotas must never change an HTTP result.
        pass


class RequestDiagnosticsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.diagnostic_request_id = request_id(request.META.get('HTTP_X_REQUEST_ID'))
        started = time.monotonic()
        response = self.get_response(request)
        if response.status_code >= 500:
            from django.http import JsonResponse
            response = JsonResponse({'error': {'code': 'server_error', 'message': '服务暂时不可用，请导出诊断信息并重试。'}}, status=500)
        response['X-Request-ID'] = request.diagnostic_request_id
        response['X-CueRelay-Build'] = settings.CUERELAY_BUILD
        match = getattr(request, 'resolver_match', None)
        route = getattr(match, 'route', None) or 'unresolved'
        context = {key: value for key, value in (getattr(match, 'kwargs', {}) or {}).items()
                   if key in {'organization_id', 'project_id'} and isinstance(value, int)}
        code = getattr(response, 'diagnostic_code', None)
        safe_codes = {'csrf_failed', 'authentication_required', 'account_changed', 'permission_denied', 'not_found',
                      'invalid_request', 'invalid_ass', 'too_large', 'rate_limited', 'invalid_credentials',
                      'project_conflict', 'project_archived', 'template_conflict', 'method_not_allowed'}
        emit({'event': 'http_result', 'request_id': request.diagnostic_request_id,
              'method': request.method, 'route': route, 'status': response.status_code,
              'duration_ms': round((time.monotonic() - started) * 1000),
              'outcome': 'conflict' if response.status_code == 409 else 'error' if response.status_code >= 400 else 'success',
              'build': settings.CUERELAY_BUILD, **context,
              **({'error_code': code} if code in safe_codes else {})})
        return response

    def process_exception(self, request, exception):
        if isinstance(exception, (PermissionDenied, Http404, SuspiciousOperation, BadRequest)):
            return None
        emit({'event': 'http_exception', 'request_id': request.diagnostic_request_id,
              'exception': exception_fields(exception)})
        # Explicit generic 500 even under DEBUG: clients never receive configuration or stack traces.
        from django.http import JsonResponse
        return JsonResponse({'error': {'code': 'server_error', 'message': '服务暂时不可用，请导出诊断信息并重试。'}}, status=500)
