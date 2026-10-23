"""HTTP-only authentication input bounds and shared API/Admin lockout responses."""
from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse
from django.utils.cache import add_never_cache_headers


def security_error(code, message, status):
    response = JsonResponse({'error': {'code': code, 'message': message}}, status=status)
    add_never_cache_headers(response)
    return response


def password_entry(path):
    return path in {
        '/api/auth/login', '/api/auth/password', '/admin/login/',
        '/admin/password_change/', '/admin/accounts/user/add/',
    } or (path.startswith('/admin/accounts/user/') and path.endswith('/password/'))


class AuthenticationSecurityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == 'POST' and password_entry(request.path_info):
            request.sensitive_post_parameters = '__ALL__'
            try:
                # Runs before CSRF middleware parses Admin form bodies.
                if (int(request.META.get('CONTENT_LENGTH') or 0) > settings.AUTH_REQUEST_MAX_BYTES
                        or len(request.body) > settings.AUTH_REQUEST_MAX_BYTES):
                    raise RequestDataTooBig
            except RequestDataTooBig:
                return security_error('too_large', '请求体过大。', 413)
            except ValueError:
                return security_error('invalid_request', '请求长度无效。', 400)
            if request.content_type != 'application/json':
                password_fields = {'password', 'password1', 'password2', 'old_password', 'new_password1', 'new_password2'}
                if any(len(value) > settings.ACCOUNT_PASSWORD_MAX_LENGTH
                       for name in password_fields for value in request.POST.getlist(name)):
                    return security_error('invalid_request', '字段类型或长度无效。', 400)

        response = self.get_response(request)
        retry_after = getattr(request, 'login_retry_after', None)
        if retry_after:
            response = security_error('rate_limited', f'登录尝试过多，请在 {retry_after} 秒后重试。', 429)
            response['Retry-After'] = str(retry_after)
        return response
