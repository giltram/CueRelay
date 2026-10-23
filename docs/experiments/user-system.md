# 用户系统验收记录

历史记录：下文显示名相关设计已于 2026-10-24 移除，当前账号只用 username；新契约与验证见 [用户名验证记录](username-only.md)。

日期：2026-10-23。实现范围为固定方案 A；音频实验实现、依赖和锁文件未修改。

## 实际环境与检查

Python 3.11.8、Django 5.2.18、psycopg 3.3.6、PostgreSQL 16.2、Node 26.4.0、Chrome 147.0.7727.101（Playwright headless）。PostgreSQL 运行在专用临时目录，仅本机监听 55432；使用独立 cuerelay / cuerelay_browser 测试数据库，没有重置或写入已有业务库。PostgreSQL 测试运行时仅安装在临时目录，不是新增的产品依赖。

| 执行项 | 结果 |
| --- | --- |
| python manage.py check | 通过，0 issues |
| python manage.py makemigrations --check --dry-run | 通过，无迁移漂移 |
| python manage.py migrate（专用浏览器数据库） | auth/accounts/admin/organizations/sessions 等首次迁移通过 |
| python manage.py test ass_format http_api organizations --noinput | 28 项通过，使用真实 PostgreSQL |
| npm run typecheck | 通过 |
| npm run test -- --run | 7 文件、88 项通过（包含既有媒体/音频与 ASS 相关前端回归） |
| npm run build | 通过 |
| node frontend/browser-tests/user-system.mjs | Chrome 完整流程通过，页面异常 0 |
| git diff --check | 通过 |
| Python AST / 前端相对 import 图检查 | 19 个后端生产文件、18 个前端源文件未发现跨模块循环；accounts 为底层、organizations 只向下依赖 accounts；media 无反向 UI 依赖 |

后端覆盖：真实 CSRF 客户端（匿名登录缺失/错误 Token、登录旋转、已登录写请求），凭证错误与限速、停用后的旧会话、本人资料/改密与其他会话失效、设置隔离与伪造 user_id、默认恢复和非法绑定、多组织不同角色、越权/字段白名单/跨组织 membership id、唯一与角色数据库约束、最后活动 organizer、Admin 创建组织/停用/成员只读与 staff 不等于 dev、旧界面不能修改其他标签页的新账号。

五种独立连接并发场景：同时降级、同时移除、同时退出、停用与移除竞争、同时停用。每种均只能一个操作成功，另一个回滚受保护，最终仍有一名活动 organizer。既有 ASS 后端转换测试继续通过。

## 浏览器验证

不占用原有 5173/8000 进程；任务临时配置将 Vite 5177 的 /api 代理到专用后端 8001。自动测试脚本版本化保存在 frontend/browser-tests/user-system.mjs；播种脚本拒绝已有用户数据库，只用于指定的临时数据库。

已检查：

- 初始无会话不挂载 video/编辑器，错误密码明确提示，登录后加载组织和角色。
- organizer 添加准确用户名、调整角色、移除；最后 organizer 降级失败。member 隐藏管理输入。
- 资料保存、错误旧密码及成功改密、快捷键保存/单项恢复/刷新、跨组织共用、换账号独立设置。
- 实际第二标签页退出、清除过期 Session Cookie、另一标签页换号：当前稿件保持；取消换号可恢复原账号继续。
- 对字幕、未应用入出点文本、选中行、视频 Object URL 做前后相等断言，并直接确认 video/时间输入 DOM 节点身份不变。
- 精确 Shift 自定义绑定有效，旧默认键不再触发；成员、个人设置及录制界面暂停全局快捷键。
- 切组织/主动退出/成员表移除自己均走编辑保护；导出实际下载的 ASS 包含稿件；取消保留内容；换账号明确放弃后才重建空工作区。
- 无组织空状态。桌面工作区截图已人工查看，原有双栏、字幕表和音频占位布局保持。

## 明确限制与待人工验收

- 尚未进行真实字幕组成员长期制作验收、多浏览器/移动端完整操作或生产 HTTPS Cookie 部署验收。
- 此记录初次验收时登录限速为每进程内存计数；现已由 [账号安全任务](account-security.md) 的 PostgreSQL 账号限制替换。生产部署仍需独立验收。
- 会话/成员变化通过受保护请求、窗口聚焦/可见和每 30 秒检查发现，不是实时推送。
- 字幕、时间输入和本地视频仍在页面内存；刷新/关闭不是自动保存。导出只包含已应用时间，保护弹窗明确提示先处理未应用输入。
- 初次切片只有组织上下文；现已实现组织项目持久化和手动字幕快照，见 [项目验收](projects.md)。样式库、编辑锁、实时协作和恢复机制仍未实现。
- 业务写入只支持文档化 services 和 Admin/API 入口；直接 ORM 批量更新或原始 SQL 不提供跨表最后 organizer 保护，维护脚本必须使用公开业务入口。

## 2026-10-23 成员与个人设置调整

按用户反馈完成七项调整：organizer 不能移除/降级其他 organizer，成员表单的按钮和输入框对齐，添加成员标签/提示/按钮文案，移除二次确认，显示名只读，删除切换账号按钮，修改密码要求两次新密码一致。dev 管理权限和最后活动 organizer 约束保持；成员写入仍按 User → Organization 锁顺序，无新增模块依赖或数据迁移。

本次实际执行：后端 `test accounts http_api organizations projects ass_format --noinput` 共 59 项通过；前端 typecheck、8 文件 91 项单测、build 通过；`git diff --check` 通过。新增 API 回归覆盖双向 organizer 移除/降级拒绝、直接 service 拒绝、本人退出、dev 移除及最后 organizer、显示名 PATCH 拒绝，以及缺失/不一致/错误类型/过长确认密码均不修改密码或使旧会话失效。

Chrome 147.0.7727.101 在全新专用 `cuerelay_identity_ui_20261023` 数据库、5177/8001 临时服务执行 `frontend/browser-tests/user-system.mjs`，九组通过，页面异常 0。额外验证移除确认/取消、同级管理入口隐藏、密码不一致时不发请求且保留输入、旧密码错误、成功后清空三项、显示名只读且无切换账号按钮；既有快捷键、跨标签页会话、稿件保护回归继续通过。对 1360px / 390px 的两组表单逐项比较输入框和按钮位置/高度，顶部误差 ≤1px 且等高；两种截图与个人设置截图已人工查看。截图目录：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-users-browser-WyQTjY`。原有手动测试数据库和账号未修改。
