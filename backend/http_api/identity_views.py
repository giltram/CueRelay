"""Session JSON boundary. Django CSRF middleware protects anonymous writes too."""
import json
from functools import wraps
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied, ValidationError, RequestDataTooBig
from django.http import JsonResponse, HttpResponse
from django.middleware.csrf import get_token
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from accounts import services as accounts
from organizations import services as organizations
from organizations.models import Organization, OrganizationMembership as Membership


def error(code, message, status):
    response = JsonResponse({'error': {'code': code, 'message': message}}, status=status)
    response.diagnostic_code = code
    return response


@never_cache
def csrf_failure(request, reason=''):
    return error('csrf_failed', '安全校验失败，请重试前刷新会话信息。', 403)


def endpoint(methods, anonymous=False):
    def decorate(function):
        @never_cache
        @wraps(function)
        def view(request, *args, **kwargs):
            if request.method not in methods:
                return error('method_not_allowed', '不支持的请求方法。', 405)
            if not anonymous and (not request.user.is_authenticated or not request.user.is_active):
                return error('authentication_required', '请重新登录，当前编辑内容已保留。', 401)
            expected_user = request.headers.get('X-CueRelay-User')
            if not anonymous and expected_user and expected_user != str(request.user.pk):
                return error('account_changed', '其他标签页已切换账号，请处理本地稿件后重新登录。', 409)
            try:
                result = function(request, *args, **kwargs)
                return result if isinstance(result, HttpResponse) else JsonResponse(result)
            except PermissionDenied:
                return error('permission_denied', '没有此组织的操作权限。', 403)
            except ObjectDoesNotExist:
                return error('not_found', '记录不存在。', 404)
            except ValidationError as exception:
                return error('invalid_request', '；'.join(exception.messages), 400)
            except RequestDataTooBig:
                return error('too_large', '请求体过大。', 413)
        return view
    return decorate


def payload(request, fields, partial=False):
    if request.content_type != 'application/json':
        raise ValidationError('请使用 JSON 请求。')
    try:
        value = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise ValidationError('无效的 JSON。')
    if not isinstance(value, dict):
        raise ValidationError('请提交 JSON 对象。')
    actual, allowed = set(value), set(fields)
    if (partial and (not actual or not actual <= allowed)) or (not partial and actual != allowed):
        raise ValidationError('仅接受字段：' + ', '.join(fields))
    return value


def string(value, max_length=150):
    if not isinstance(value, str) or len(value) > max_length:
        raise ValidationError('字段类型或长度无效。')
    try:
        value.encode()
    except UnicodeError:
        raise ValidationError('字段编码无效。')
    return value


@endpoint(['GET'], anonymous=True)
def session(request):
    return {'user': accounts.safe_user(request.user) if request.user.is_authenticated else None, 'csrf_token': get_token(request)}


@endpoint(['POST'], anonymous=True)
@sensitive_post_parameters()
@sensitive_variables()
def sign_in(request):
    data = payload(request, ['username', 'password'])
    username = string(data['username'])
    password = string(data['password'], settings.ACCOUNT_PASSWORD_MAX_LENGTH)
    user = authenticate(request, username=username, password=password)
    if user is None:
        return error('invalid_credentials', '用户名或密码不正确。', 401)
    login(request, user)
    return {'user': accounts.safe_user(user), 'csrf_token': get_token(request)}


@endpoint(['POST'])
def sign_out(request):
    payload(request, [])
    logout(request)
    return {'user': None, 'csrf_token': get_token(request)}


@endpoint(['GET'])
def me(request):
    return {'user': accounts.safe_user(request.user)}


@endpoint(['POST'])
@sensitive_post_parameters()
@sensitive_variables()
def password(request):
    data = payload(request, ['old_password', 'new_password', 'new_password_confirmation'])
    new_password = string(data['new_password'], settings.ACCOUNT_PASSWORD_MAX_LENGTH)
    confirmation = string(data['new_password_confirmation'], settings.ACCOUNT_PASSWORD_MAX_LENGTH)
    if new_password != confirmation:
        raise ValidationError('两次输入的新密码不一致。')
    accounts.change_password(request, string(data['old_password'], settings.ACCOUNT_PASSWORD_MAX_LENGTH),
                             new_password)
    return {'csrf_token': get_token(request)}


@endpoint(['GET', 'PATCH'])
def personal_settings(request):
    if request.method == 'PATCH':
        return accounts.save_settings(request.user, payload(request, ['shortcut_overrides', 'audio_display_mode', 'mouse_sets_cue_boundary'], partial=True))
    return accounts.settings_for(request.user)


def organization_data(org, actor):
    role = Membership.objects.filter(organization=org, user=actor).values_list('role', flat=True).first()
    return {'id': org.pk, 'name': org.name, 'role': role, 'can_manage': actor.is_superuser or role == 'organizer'}


def member_data(member):
    return {'id': member.pk, 'username': member.user.username,
            'role': member.role, 'is_active': member.user.is_active, 'user_id': member.user_id}


@endpoint(['GET'])
def organization_list(request):
    query = Organization.objects.all() if request.user.is_superuser else Organization.objects.filter(memberships__user=request.user)
    return {'organizations': [organization_data(org, request.user) for org in query.order_by('id')]}


def accessible(request, organization_id, manage=False):
    org = Organization.objects.get(pk=organization_id)
    organizations.require_access(request.user, org, manage)
    return org


@endpoint(['GET', 'PATCH'])
def organization_detail(request, organization_id):
    org = accessible(request, organization_id, request.method == 'PATCH')
    if request.method == 'PATCH':
        org = organizations.rename_organization(request.user, organization_id, payload(request, ['name'])['name'])
    return {'organization': organization_data(org, request.user)}


@endpoint(['GET', 'POST'])
def members(request, organization_id):
    org = accessible(request, organization_id, request.method == 'POST')
    if request.method == 'POST':
        username = string(payload(request, ['username'])['username'])
        organizations.add_member(request.user, organization_id, username)
    return {'members': [member_data(member) for member in org.memberships.select_related('user').order_by('id')]}


@endpoint(['PATCH', 'DELETE'])
def member(request, organization_id, membership_id):
    accessible(request, organization_id, True)
    if request.method == 'PATCH':
        role = payload(request, ['role'])['role']
        if role not in ['organizer', 'member']:
            raise ValidationError('无效的组织角色。')
        organizations.change_member(request.user, organization_id, membership_id, role=role)
    else:
        payload(request, [])
        organizations.change_member(request.user, organization_id, membership_id)
    return {'ok': True}


@endpoint(['POST'])
def leave(request, organization_id):
    accessible(request, organization_id)
    payload(request, [])
    organizations.change_member(request.user, organization_id, leave=True)
    return {'ok': True}
