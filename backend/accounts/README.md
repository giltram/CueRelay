# accounts

拥有 User 身份、本人密码/资料、PersonalSettings。User 与 services 中 safe_user、settings_for、save_settings、change_password 是公开契约；shortcuts 读取根 shared JSON 并验证覆盖。无组织、HTTP、媒体或格式依赖。

不隐式创建设置记录，不保存明文密码。账号角色只使用 Django is_superuser；组织角色不在本模块。账号停用的跨组织协调入口由 application.identity_admin 拥有；不在此反向导入 organizations。

backends.AccountBackend 是统一的 Django 密码登录入口，继承 ModelBackend；同步和异步认证共用 PostgreSQL LoginAttempt 行锁，检查/密码校验/滑动窗口计数同事务。账号键为规范化用户名摘要，未知账号也计数；5 次/15 分钟触发固定 5 分钟冷却，锁定请求不续期。失败必须在提交后抛 PermissionDenied 终止兼容 backend 回退。此模块不生成 HTTP 响应，只在 request 上标记 login_retry_after。参数在 application.settings，详细入口/状态与部署契约见 [安全文档](../../docs/account-security.md)。

password_validation.MaximumLengthValidator 与 Django 验证器共同拥有 15–1024 字符密码策略；change_password 在哈希前再次检查长度，并验证旧密码。登录不应用新密码长度下限。LoginAttempt 不注册 Admin，不保存密码；management/commands/clear_login_attempts.py 供每日清理至少 24 小时未更新的状态。

测试：tests.py 覆盖密码/API/Admin/滑动窗口/冷却/独立连接并发和异步认证；../http_api/test_identity.py 覆盖 CSRF、会话及设置。首次迁移在 migrations/0001_initial.py；新增登录状态为 0002_loginattempt.py。必须在首次 migrate 前配置 AUTH_USER_MODEL。
