# 账号安全实施计划

日期：2026-10-23。范围：密码策略、API/Admin 登录防护、输入边界与验证，不引入 IP 限流、CAPTCHA、MFA 或新 UI。

1. 通过 AUTH_PASSWORD_VALIDATORS 将最短长度设为 15，保留相似性、常见密码和纯数字限制，统一最大长度 1024；覆盖现有 API 改密及 Admin 创建/重置/本人改密。
2. 使用 accounts 的小型 ModelBackend 子类及 PostgreSQL 行锁，账号维度维护至多 5 个失败时间和固定冷却截止时间。authenticate 的检查、密码计算和更新在同一事务内，失败结果在提交后抛出 PermissionDenied，防止后续兼容 backend 绕过限制。同步和异步 authenticate 共用实现。
3. HTTP 层统一锁定 JSON/Retry-After，认证请求体限制在 CSRF 解析前执行。保留历史 ModelBackend 路径以读取已有 Session。
4. 真实 PostgreSQL 测试实际 API/Admin、密码规则、冷却/滑动窗口、独立连接并发和敏感信息边界。同步部署与模块文档。

方案评估：django-axes 8.3.2 支持 Django 信号/API/Admin，但默认失败窗口和冷却共用 cooloff，计数更新发生在校验密码之后；若满足独立窗口/冷却且严格限制并发密码计算，需要自定义 handler 和跨认证流程锁。现有 PostgreSQL 足够提供所需持久化和事务锁，因此选择小型、集中、可测试的认证 backend，避免增加库及其定制层。参考：[配置](https://django-axes.readthedocs.io/en/stable/4_configuration.html)、[数据库 handler](https://github.com/jazzband/django-axes/blob/8.3.2/axes/handlers/database.py)。

部署验证只使用隔离测试库；不把本地检查描述为生产部署验收。账号级限制无法彻底消除恶意反复锁定，但锁定中请求不续期，到期清空失败记录，成功登录也清空记录。单 IP 防护留待 nginx。

实施状态：已完成上述四步。本地 44 项后端测试（含多进程共享与并发）、88 项前端测试及构建通过；部署检查仍有 3 项既有告警。详细结果和修改文件见 [验证记录](../experiments/account-security.md)。生产发布及业务库迁移留待部署时执行。
