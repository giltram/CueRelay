# accounts

拥有 User 身份、本人密码/资料、PersonalSettings。User 与 services 中 safe_user、settings_for、save_settings、change_password 是公开契约；shortcuts 读取根 shared JSON 并验证覆盖。无组织、HTTP、媒体或格式依赖。

不隐式创建设置记录，不保存明文密码。账号角色只使用 Django is_superuser；组织角色不在本模块。账号停用的跨组织协调入口由 application.identity_admin 拥有；不在此反向导入 organizations。

HTTP、CSRF、会话及设置测试：../http_api/test_identity.py。首次迁移在 migrations/0001_initial.py；必须在首次 migrate 前配置 AUTH_USER_MODEL。
