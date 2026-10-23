# 用户、组织和个人设置

状态：2026-10-23 已实现固定权限方案 A。账号切片后已接入 [项目面板和手动快照保存](projects.md)。登录或切换组织本身不代表本地稿件已保存或归属某项目；组织样式库、实时协作、编辑锁和恢复机制仍未实现。

## 身份与权限

四个业务实体：

| 实体 | 字段与约束 |
| --- | --- |
| accounts.User | AbstractUser + display_name（80 字符）；用户名登录，邮箱可空；Django 密码摘要与验证器；停用代替删除 |
| Organization | id、name（1–100 字符）、created_at |
| OrganizationMembership | organization、user 外键，role、joined_at；组织/用户联合唯一；数据库检查 role 仅 organizer/member |
| PersonalSettings | user 一对一主键、shortcut_overrides JSON、updated_at；无组织字段，无记录时返回默认值，按需创建 |

Django 自带 auth、Admin、contenttypes、session 等表正常保留。dev 使用 is_superuser；is_staff 仅提供 Admin 登录资格，不授予组织权限。organizer/member 属于成员关系，同一账号可以在不同组织拥有不同角色，不使用全局 Group 映射组织角色。

member 查看本组织及成员、退出自己所在组织。organizer 还可改组织名、按准确用户名添加活动账号（初始 member）、提升 member、移除 member；不能移除或降级其他 organizer，避免先降级再移除的绕过。本人仍可降级或退出，但必须满足最后活动 organizer 约束。organizer 不能修改站点字段、授予 dev、停用全站账号或管理其他组织。dev 可以管理全部组织及 organizer，无需伪造成员关系。不提供用户目录、公开注册、邮件邀请或第三方登录。

显示名由 dev 在 Django Admin 维护；个人设置只读展示，不提供本人资料写接口。成员移除先显示账号和组织的确认框，取消不发送移除请求；移除自己沿用退出组织的确认及本地稿件保护流程。

## 配置与 Admin

环境配置和启动命令见根 README / .env.example。PostgreSQL 是唯一业务数据库。AUTH_USER_MODEL 已在首次迁移前设置；仓库此前没有数据库配置或业务迁移，本任务没有重置已有数据库。

使用 createsuperuser 建立首位 dev，之后在 Django Admin 创建账号、重置密码或停用账号。账号删除操作关闭，User.delete 也拒绝硬删除。Admin 中创建组织时必须选择活动的初始 organizer，组织与成员关系同事务提交。组织删除关闭；成员表在 Admin 只读，成员变更使用应用界面/API。只有 dev 能访问这些模型的管理操作。

所有支持的成员写入经过 organizations.services；账号停用通过 application.identity_admin.save_account 协调。锁顺序是目标 User → 按 id 排序的 Organization。持有组织锁后重新鉴权、写入并验证至少一名活动 organizer，失败回滚。停用账号先锁该用户，再锁其全部组织并验证。创建组织/添加成员也先锁用户，避免停用与新增关系竞态。Admin 使用相同入口，无隐式信号。维护脚本必须调用这些入口；直接 QuerySet.update/delete、原始 SQL 不属于受支持的业务写入契约。

## 会话与 HTTP

Session 存 PostgreSQL，Cookie 为 HttpOnly、SameSite=Lax，默认 7 天；生产 DEBUG=0 默认启用 Secure Cookie，开发 HTTP 需 DEBUG=1。SECRET_KEY 和连接信息只从环境读取，缺少密钥时拒绝启动。

Django CsrfViewMiddleware 保护全部身份/组织/设置写请求，包括匿名登录。GET session 初始化 CSRF；登录旋转 CSRF，前端每次写请求读取当前 CSRF Cookie。敏感响应 no-store。改密要求旧密码、新密码和确认新密码，前后端均校验两份新密码完全一致；失败保留输入，成功清空三项。使用 Django update_session_auth_hash 保留当前会话；其他旧会话后续校验失效，停用账号也不能通过旧会话访问接口。个人设置保留退出账号入口，已移除重复的切换账号按钮。

登录普通错误为 invalid_credentials；API/Admin 共用 accounts.AccountBackend，账号 15 分钟内失败 5 次进入固定 5 分钟冷却，429 rate_limited 带 Retry-After。PostgreSQL 行锁覆盖校验与计数，多 worker 共享状态，冷却期间不执行密码哈希也不延长锁定。不存在的账号同样处理，不暴露是否存在。原进程内 IP 缓存已移除；IP 限速留待 nginx。密码设置/修改/重置统一为 15–1024 字符，保留 Django 弱密码、相似性和纯数字限制；既有短密码仍可登录。详见 [安全与部署说明](account-security.md)。

| 接口 | 契约 |
| --- | --- |
| GET /api/auth/session | 当前安全用户字段或 null，csrf_token；匿名可访问 |
| POST /api/auth/login | username、password；安全用户字段与新 csrf_token |
| POST /api/auth/logout | 空 JSON；不能 GET 退出 |
| GET /api/auth/me | 只读安全用户字段；PATCH 返回 405 |
| POST /api/auth/password | old_password、new_password、new_password_confirmation；确认值必须一致 |
| GET /api/organizations | 当前可访问组织、该组织 role、can_manage |
| GET/PATCH /api/organizations/{id} | 查看；PATCH 仅 name |
| GET/POST /api/organizations/{id}/members | 查看；POST 仅准确 username |
| PATCH/DELETE /api/organizations/{id}/members/{membership_id} | PATCH 仅 role；DELETE 空 JSON；成员关系必须属于 URL 组织 |
| POST /api/organizations/{id}/leave | 空 JSON，退出本人关系 |
| GET/PATCH /api/me/settings | GET 返回覆盖和共享默认值；PATCH 仅 shortcut_overrides，替换整份覆盖 |

身份由 Session 决定；每次请求检查活动账号与目标组织。JSON 未知字段整体拒绝。错误格式为 `{error: {code, message}}`，区分 401 authentication_required/invalid_credentials、403 permission_denied/csrf_failed、400 invalid_request、404 not_found、429 rate_limited。前端额外带 X-CueRelay-User 进行账号一致性检查；Cookie 已被其他标签页换号时返回 409 account_changed，防止旧界面修改新账号资料。这个头不能授予权限。

/api/ass/* 单独声明 AllowAny 且不执行身份认证，只做有限格式转换，无持久副作用，不读取账号或组织，维持大小限制；会话过期仍可导出。其他新 DRF 接口默认 IsAuthenticated，身份 JSON 适配器也默认受保护。

## 快捷键

shared/timing-shortcuts.json 是默认动作、名称、绑定的唯一权威来源，Python 和 TypeScript 直接读取。稳定动作：commit、selection、before-start、after-end、first-500、last-500。

覆盖一个动作会替换该动作全部别名（例如 commit 默认 G/Enter/NumpadEnter）；空数组禁用；删除该键恢复全部默认别名；保存与默认完全相同的列表会归一化移除覆盖。保存时对最终有效配置检查重复与跨动作冲突，包括恢复默认后产生的冲突。

采用物理 KeyboardEvent.code，允许 KeyA–KeyZ、Digit0–Digit9、Enter、NumpadEnter、Space，以及 Shift+字母/数字；其他键和 Ctrl/Meta/Alt 组合一律视为不支持/保留组合。每动作至多四个绑定。设置界面可录制一个组合、填写逗号分隔多绑定、禁用及单项/全部恢复；恢复操作在保存后持久化。

匹配修饰键与焦点/IME 过滤分开；精确匹配全部修饰键。输入框、contenteditable、video、IME、重复及已处理事件过滤保持不变；按钮/链接/summary 上 Space/Enter 保留原生激活。登录、设置（含录制）、成员管理和编辑保护弹窗打开时暂停工作区全局快捷键。

## 编辑保护

App 拥有账号/组织上下文，EditorWorkbench 暴露 hasContent/exportDraft。首次会话检查完成前不挂载编辑器；曾登录后的会话失效只改变账号提示，保留组件实例、字幕、未应用时间、选中行、本地 File/Object URL 与 video。每 30 秒、窗口重新聚焦/可见时重新检查会话；受保护请求返回 authentication_required/account_changed 也触发原位重新登录。一般权限或 CSRF 错误不会被误当成会话过期。

同账号重新登录和普通会话刷新不改变编辑器 key。只有用户明确放弃后切换组织/账号，或退出并再次进入，才创建新工作区。有字幕、导入标记、时间输入、本地视频、转换中或待确认导入即要求处理；保护弹窗提供导出、取消、明确放弃。导出只含已应用字幕，弹窗明确提示先取消并应用需要保留的时间输入。导出不自动放弃，失败也保持当前稿件。

另一标签页退出只使本页提示失效；另一标签页登录不同账号会进入明确的稿件处理步骤。前端会丢弃来自旧账号上下文的异步响应。组织切换选择项目上下文，不自动上传、保存或转移已有本地字幕。项目仅在用户显式新建并确认初始化、或点击保存项目后写入快照。

## 验证入口

后端：`python manage.py test accounts ass_format http_api organizations`，含真实 CSRF 客户端、Admin 写入、账号防护及 PostgreSQL 多连接竞争测试。前端：`npm run typecheck`、`npm run test -- --run`、`npm run build`。

可执行 Chrome 浏览器测试：frontend/browser-tests/user-system.mjs。准备一个**新建的专用 cuerelay_browser PostgreSQL 数据库**，设置 PGDATABASE=cuerelay_browser、DJANGO_DEBUG=1、私有测试 DJANGO_SECRET_KEY、BROWSER_TEST_PASSWORD。在相同环境下运行 migrate，再从仓库根执行 `python backend/manage.py shell < backend/browser_tests/seed.py`（已有用户时拒绝播种）。启动该数据库的后端和 Vite，然后设置 USER_SYSTEM_URL 为 Vite 地址、BROWSER_TEST_PASSWORD 与播种一致，执行 `node frontend/browser-tests/user-system.mjs`。若使用不同端口，同步配置 Vite 代理与 Django 可信 CSRF Origin；不要中断其他实验进程。脚本创建合成视频、验证 UI/下载/DOM 实例保留并输出截图目录，需要本机 Chrome 与 FFmpeg。

本任务实际结果见 [验收记录](experiments/user-system.md)。自动浏览器检查不代表真实成员制作验收或生产部署验收通过。
