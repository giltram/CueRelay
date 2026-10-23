# 密码与登录安全

2026-10-23。仅记录已实现的 Django 防护；生产 HTTPS/反向代理及多 worker 部署未验收。

## 密码入口与规则

`application/settings.py` 的 `AUTH_PASSWORD_VALIDATORS` 是设置密码的统一策略：15–1024 个字符；不要求大小写、数字或符号组合；保留 Django 常见密码、纯数字、用户属性相似性检查。相似性覆盖 username、first_name、last_name、email 和自定义 display_name。

| 实际入口 | 验证与权限 |
| --- | --- |
| POST /api/auth/password | accounts.services.change_password：校验旧密码，再 validate_password，事务中更新；当前 Session 保留，其他旧 Session 失效 |
| Admin 创建用户 | Django UserAdmin/AdminUserCreationForm 调用统一验证器；仅 dev |
| Admin 设置/重置成员密码 | Django AdminPasswordChangeForm 调用统一验证器；仅 dev；这是管理员重置，不要求成员旧密码 |
| Admin 本人修改密码 | Django AdminPasswordChangeForm（admin.forms）/PasswordChangeForm，校验本人旧密码及统一验证器 |

没有公开注册、邮件找回、DRF Basic/Token 或第三方登录入口。`createsuperuser`/`changepassword` 使用 Django 校验（createsuperuser 自带的人工确认绕过仍属于受信任运维操作）。直接 ORM create_user/set_password 不会自动调用验证器，这是 Django 的标准行为；维护脚本设置密码时必须显式 validate_password。

登录只验证摘要，不重新应用设置策略，因此既有短密码仍可登录，不强制立即改密。

## 账号失败限制

`accounts.backends.AccountBackend` 复用 Django ModelBackend 的密码校验、未知账号等成本哈希和活动账号检查。所有 Django authenticate/aauthenticate 登录均先经过该 backend，实际包括 JSON 登录及 Admin 登录。

- `LOGIN_FAILURE_LIMIT = 5`；`LOGIN_FAILURE_WINDOW_SECONDS = 900`；`LOGIN_COOLOFF_SECONDS = 300`，集中于 settings。
- `accounts.LoginAttempt` 的主键为规范化用户名的 SHA-256；记录最近至多 5 个失败时间、locked_until、updated_at。不存在的用户名同样计数；用户名 NFKC 归一化并去除首尾空白，保持 Django 默认大小写敏感语义。IP、User-Agent、客户端 Cookie 不参与账号键。
- 同一数据库事务内 get_or_create/select_for_update、检查冷却、校验密码、更新记录；首次并发创建由主键唯一约束和 get_or_create 处理。锁贯穿昂贵校验，使等待请求在取得锁后重查限制。所有 worker 必须连接同一个 PostgreSQL 主库，不能把该表路由到只读副本。
- 第 5 次失败起返回 429；接下来的请求在哈希之前拒绝。冷却期间不写记录、不延长截止时间。到期清空旧计数并重新允许尝试；阈值前成功登录也清空计数。普通错误 API 为 401 invalid_credentials；锁定 API/Admin 统一 `{error: {code: rate_limited, message}}` 和整数秒 Retry-After，响应 no-store。Admin 普通错误保留 Django 表单，锁定时返回同一 JSON。
- 失败在事务提交后抛出 PermissionDenied，终止 Django 的 backend 链；后续 ModelBackend 路径仅为读取升级前 Session 保留，不能成为失败回退。不得交换这两个 backend 的顺序。显式覆盖 aauthenticate，避免继承 ModelBackend 的独立异步校验绕过限制。
- 认证状态不依赖进程内缓存。accounts 不依赖 HTTP 或 organizations；只把 retry_after 秒数标记在 request，HTTP 层负责响应。

账号级限制仍可能被攻击者周期性触发；固定 5 分钟冷却、不续期、到期重置缓解长期锁定，不代表彻底消除账号拒绝服务。不同账号的密码喷洒/大规模来源流量还需要未来 nginx 的单 IP/流量防护，本次未实现。

选择该小型 backend 前已评估 django-axes 8.3.2：其默认窗口和冷却共用 cooloff，失败统计在校验之后；满足本次独立时长和严格并发要求需额外 handler/流程锁。使用现有 PostgreSQL 可避免新增依赖和定制库层。资料及执行计划见 [实施计划](plans/account-security.md)。

## 输入和日志

`http_api.auth_security.AuthenticationSecurityMiddleware` 在 CSRF 解析前，为 API 登录/改密、Admin 登录/本人改密/创建用户/成员重置限制请求体 32 KiB。该预算可容纳两份 1024 字符密码的 JSON surrogate 转义或表单编码。超限返回 413 too_large；密码字段超过 1024 返回 400，发生在哈希之前。通用请求体仍使用既有的 Django 3 MiB 限制，不改变 ASS 契约。

accounts.security 日志只记录事件和账号摘要：login_limited 为 WARNING，login_failed/login_succeeded 为 INFO（启用该级别才输出）。不记录原始用户名、密码、请求体、认证头或完整凭证；不建立永久登录历史表。JSON 登录/改密函数及认证 backend 标记敏感变量，Admin 密码 POST 标记敏感字段。运维日志采集也不得额外开启请求体/凭证记录。

改密不是匿名验证入口，必须已有活动 Session、正确 CSRF 和正确旧密码；没有新增公开认证入口。

## 部署操作与验证边界

1. 发布代码前后协调维护窗口，在相同版本的运行环境执行 `python manage.py migrate`，应用 accounts.0002_loginattempt，然后重启全部 Django 进程。缺失迁移会报错；本任务未替业务库执行迁移。
2. 所有 worker 使用同一 PostgreSQL 数据库和迁移结果。无需 Redis、axes 或新依赖，账号限制不依赖真实客户端 IP。不要修改认证 backend 顺序。
3. 使用既有配置设置私有 SECRET_KEY、DEBUG=0、实际 ALLOWED_HOSTS 和必要的 CSRF_TRUSTED_ORIGINS，通过 HTTPS 提供服务；Secure Cookie 已由 DEBUG=0 默认启用。check --deploy 仍提示现有 X-Frame-Options、HSTS、HTTPS 重定向缺失；按实际部署补齐这些响应头/跳转。不要凭空信任 X-Forwarded-*；可信代理头由实际 TLS 拓扑决定后再配置和验收。
4. 每天运行 `python manage.py clear_login_attempts`，删除至少 24 小时未更新的记录（自动取不短于失败窗口/冷却的保留期），防止任意未知用户名长期积累。限制的到期解除由登录事务自动处理，与清理任务是否执行无关。
5. 在部署环境使用专用测试账号验证：API/Admin 共用失败次数，5 次失败后换 worker 仍返回 429/Retry-After，到期恢复，旧 Session/正常改密/登出正常。不要对真实成员账号做暴力测试。
6. 请求体预算限制的是 Django 处理与密码计算；ASGI 服务可在进入中间件前缓冲网络请求。未来部署 nginx 时另配传输层请求体上限、连接超时和单 IP 限速，不能把本地应用层测试视作这些保护已上线。

本地自动检查及真实 PostgreSQL 并发结果见 [安全验证记录](experiments/account-security.md)。生产多进程、HTTPS 和网络入口尚未验证。
