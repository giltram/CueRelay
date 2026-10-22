# 用户系统设计

状态：2026-10-23 待确认方案；本轮只设计，不实现。依据当前代码与既有产品边界，先完成身份与登录闭环，随后接项目成员权限；音频处理仍延后。

## 1. 推荐范围

采用 Django 内置认证能力、最小自定义 User、PostgreSQL 和数据库 Session，前端沿用同源 `/api` 代理。第一期面向内部字幕组，推荐管理员建号，不开放公开注册，不接邮件验证、第三方登录或独立身份服务。

第一期包含：登录、退出、刷新识别当前用户、修改显示名、修改本人密码；站点管理员通过 Django Admin 创建/停用账号及重置密码。成员忘记密码先由管理员处理。首位站点管理员通过管理命令创建，不在应用代码中放默认账号或密码。

项目创建、项目成员管理与工种权限在下一切片接入，不为账号功能提前实现字幕持久化、实时锁或恢复代号。账号登录本身不代表字幕已经保存到服务器。

## 2. 当前代码的接入前提

- `application/settings.py` 当前 `DATABASES = {}`，没有 auth/session/CSRF 中间件，DRF 认证与权限均为空；本轮账号实现将首次引入数据库与迁移。
- `App.tsx` 直接渲染 EditorWorkbench。字幕/时间草稿在组件内存，本地 File/Object URL 在 LocalVideoPlayer；不能因会话变化直接卸载这些组件。
- `/api/ass/*` 是纯格式转换，没有用户或项目数据。它与未来带权限的项目导入/导出接口不是同一契约。

## 3. 身份、数据与权限边界

推荐 `accounts.User(AbstractUser)`：沿用用户名、密码摘要、活动状态和 Django 标准管理字段，只增加显示名；邮箱暂不作为必填项或登录凭证。不另建 UserProfile，不在 User 上增加“翻译/打轴/校对”字段。先设置 `AUTH_USER_MODEL` 再执行首次迁移，避免后续切换用户表。[Django 自定义用户文档](https://docs.djangoproject.com/en/5.2/topics/auth/customizing/#using-a-custom-user-model-when-starting-a-project)

| 层次 | 负责什么 | 边界 |
| --- | --- | --- |
| 站点账号 | 身份、密码、显示名、账号停用 | accounts 所有；普通成员只改自身允许的字段 |
| 站点管理员 | 建号、停用、重置密码 | Django Admin；不把项目管理员自动提升为 staff/superuser |
| 项目成员 | 某用户能否访问某项目、具备哪些能力 | 后续 projects 所有，沿用 domain-model 的可叠加工种预设 |

同一用户可在不同项目有不同能力。前端按钮显隐只是提示，服务端按项目成员关系鉴权；不能把“已登录”当成未来任意项目的访问许可。账号停用禁止后续认证请求，用户历史不靠硬删除清理。

## 4. 登录与会话

- 用户名/密码登录，复用 Django 密码校验、登录、退出及密码验证器，不自制密码算法或 Token 系统。
- 使用 PostgreSQL 保存 User 与 Django Session，不为登录引入 Redis。Session ID 放 HttpOnly Cookie，不放 localStorage；建议默认有效期 7 天，第一期不增加“记住我”分支。
- 延续同源访问。生产环境使用 HTTPS、Secure Cookie、SameSite=Lax；开发环境按本机 HTTP 单独配置。当前公开固定 SECRET_KEY 必须改为环境配置，不能用于真实账号环境。
- 所有认证相关写请求校验 CSRF，登录本身也包括在内；登录后使用更新的 CSRF Token。DRF 的 SessionAuthentication 对匿名请求的默认行为不足以保护登录，登录入口要显式使用 Django 的 CSRF 保护。[DRF SessionAuthentication](https://www.django-rest-framework.org/api-guide/authentication/#sessionauthentication)、[Django CSRF](https://docs.djangoproject.com/en/5.2/howto/csrf/)
- 登录失败统一反馈，做短期限速，不引入永久账号锁定或复杂风控。敏感响应不缓存，日志不记录密码、Cookie 或字幕正文。
- 本人改密需要旧密码，成功后保留当前会话、使其他旧会话在后续校验时失效；复用 Django 的会话更新能力。[Django 改密与会话](https://docs.djangoproject.com/en/5.2/topics/auth/default/#session-invalidation-on-password-change)

## 5. 最小接口

以下为建议契约，不固定最终 JSON 的全部字段。

| 接口 | 职责 |
| --- | --- |
| `GET /api/auth/session` | 返回当前用户或 null，并提供 CSRF 初始化；不返回其他账号信息 |
| `POST /api/auth/login` | 校验凭证，建立会话，返回用户与更新后的 CSRF 信息 |
| `POST /api/auth/logout` | 结束当前浏览器会话；不能通过 GET 退出 |
| `PATCH /api/auth/me` | 修改本人显示名；禁止传入角色、staff、active 等管理字段 |
| `POST /api/auth/password` | 校验旧密码并修改密码 |

不单独建设账号管理前端 API，先复用 Django Admin。受保护 API 默认要求活动用户，只有会话初始化、登录等入口显式匿名可用。错误要区分 `authentication_required`、`permission_denied`、`csrf_failed`、`invalid_credentials`，不能把所有 HTTP 403 都理解为“登录过期”；DRF SessionAuthentication 的未认证拒绝本身也可能是 403。

推荐现有 `/api/ass/*` 第一阶段继续作为显式公开、无持久副作用的格式工具，使用独立访问策略，忽略账号身份，不读取项目数据，继续保留请求大小限制。这样会话失效仍可导出页面内字幕。后续 `/api/projects/...` 的导入/导出必须检查项目权限，不能继承此公开策略。若以后要求格式工具也仅限成员访问，再作为服务开放策略单独调整。

## 6. 编辑页面的登录体验

初次进入：检查会话；未登录显示登录页，登录成功后进入编辑器，顶栏显示名称和账号菜单。个人设置只含显示名与改密，管理员另有管理入口。

正在编辑时：

1. 会话过期或另一标签页退出：保留已挂载的编辑器、本地视频与全部内存输入，停止需认证的操作，原位提示重新登录；不自动跳转或清空文档。
2. 同一用户重新登录：继续当前工作，不重新加载空文档、不重建 video；刷新 CSRF 信息，不盲目重试密码修改等写操作。
3. 切换到另一账号：不自动把旧账号的稿件归到新账号；先要求导出或明确放弃，再清理旧工作区并进入新账号。
4. 主动退出：有编辑内容时，先提供导出/取消/明确放弃的选择；退出确认后才清理当前页面数据。不能依赖 beforeunload 保护 React 组件卸载。

当前尚无项目云端保存，因此无需为这次登录功能建设完整离线草稿系统。后续项目持久化再采用既有 realtime-protocol 的草稿/未决命令规则。

## 7. 模块与实施顺序

- `accounts`：User、Admin 注册、认证/个人资料操作与相关测试；不依赖 projects 或前端。
- `http_api`：认证 HTTP 适配、输入白名单和错误映射，通过 accounts 公共入口处理账号操作。
- `application`：PostgreSQL、认证/会话/CSRF 中间件、路由与环境配置。
- 前端账号模块与 App：会话初始化、登录页、账号菜单和原位登录；不把账号逻辑放进 media 或 ass_format。EditorWorkbench 仅提供退出前的编辑状态/导出协作接口。

建议下一 Coding Task 只实现上述账号闭环及页面接入：先建用户表和会话，再接接口与前端，最后验证编辑保护。完成后另做 ProjectMembership 与项目入口，不同时铺开团队、邀请邮件或实时协作。

## 8. 验收

- 管理员可建号/停用/重置；普通用户不能修改他人资料或管理字段，停用账号的旧会话不能访问受保护接口。
- 正确/错误密码、刷新保留登录、POST 退出、本人改密与其他旧会话失效均有测试。
- 用真正启用 CSRF 检查的测试客户端验证匿名登录也拒绝缺失/错误 Token，区分认证、权限和 CSRF 错误。
- 编辑中会话失效、双标签页退出、同账号重新登录不丢字幕/时间输入/视频；换账号与主动退出必须有明确的数据处理步骤。
- ASS 格式转换及现有媒体、时间和快捷键回归继续通过；新增账号能力不改变视频本地处理边界。

以上账号加入方式、用户名登录和公开格式工具策略为本轮推荐，尚未作为已获确认的产品变更；本轮未修改应用代码、安装依赖或执行迁移。
