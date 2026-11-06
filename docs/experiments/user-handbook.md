# 使用手册与首次提示验证

执行：2026-11-07。范围和数据所有权见 [实施计划](../plans/user-handbook.md)、[架构入口](../architecture.md) 与 [手册模块](../../frontend/src/handbook-ui/README.md)。

## 已执行

- 前端 `npm run typecheck`、`npm run test -- --run`（38 个文件、348 项测试）、`npm run build` 均通过。路由覆盖普通/带组织手册地址、尾斜杠规范化、组织 ID 校验与上下文保持。
- 加载 `.env` 后 `.venv/bin/python backend/manage.py test accounts.test_migrations http_api.test_identity --noinput`：22 项通过，使用独立 PostgreSQL 测试数据库。覆盖新账号默认、仅升级已登录旧账号跳过提示、原密码/会话/组织/项目/个人设置保留、本人幂等确认、账号隔离、匿名拒绝、CSRF、账号一致性头、禁止通过设置 PATCH 重置或越权确认。
- `manage.py check`、`manage.py makemigrations --check --dry-run` 通过。已对本机开发数据库执行 `manage.py migrate accounts 0006`，新增字段迁移成功，无其他待生成模型迁移；部署其他环境仍需同步迁移和前后端。
- `npm run test:handbook`：Chrome 147.0.7727.101，前端 5198，HTTP 内存夹具，不写开发数据库。验证深链接登录后首次弹窗、稍后阅读/Escape、延迟失败不阻塞操作、失败后刷新重试、打开链接确认、刷新不再弹、账号隔离、旧账号无提示、无组织手册、设置入口、新 tab / opener 隔离和来源输入保留。
- 手册内容六节、目录目标、目录滚动、刷新、1440×1000 与 390×844 无页面横向溢出通过。已查看首次提示、桌面和窄屏完整截图（`/tmp/cuerelay-handbook/{prompt,desktop,mobile}.png`），确认正文/表格可读，目录在窄屏换行，不需要额外向导步骤。浏览器无 pageerror 或意外 API 请求。
- `PERSONAL_SETTINGS_URL=http://127.0.0.1:5198 npm run test:personal-settings-pending` 与 `SESSION_URL=http://127.0.0.1:5198 npm run test:session-observation` 通过，覆盖设置请求期间保护和登录/会话观察竞争。
- 对 102 个生产 TS/TSX 模块的相对 import/from 依赖做 DFS（含 type imports）：无循环。handbook-ui 只向下依赖 navigation/page-ui/共享默认 JSON；账号确认没有引入组织或工作区反向依赖。`git diff --check` 通过。

## 交互决策与边界

首次提示不要求阅读或等待网络：点链接、稍后阅读或 Escape 都立即收起；异步确认失败仅在页头说明，下次页面加载仍可能提示。浏览器内本次关闭状态按账号隔离，成功确认以数据库为准，不用 localStorage。

阅读手册页面本身不弹首次提示，也不隐式改已确认状态。之后进入其他页面，尚未确认的新账号仍可收到提示。目录普通点击只滚动当前正文，不产生 fragment 历史条目；保留真实 href 以便复制/新开。手册沿用应用登录边界；未登录深链接登录后继续原地址。

浏览器验证使用夹具，真实后端的身份与持久化由 PostgreSQL HTTP/迁移测试覆盖。本次没有运行真实新手试用或 Safari/Firefox 验收，没有增加实时协作、自动保存或字幕恢复机制。

## Markdown 构建调整（2026-11-07）

用户确认正文改为独立 Markdown 并在构建时加载。`handbook.md` 是唯一正文/标题来源，Vite 转换为导出介绍及章节 HTML 的 JS 模块；`Marked 18.1.3` 仅为 devDependency，没有运行时 Markdown 请求/解析器。快捷键占位符仍使用共享 JSON，标题中的稳定 ID 保持原目录跳转。普通 Markdown 引用沿用原重点提示样式；中文加粗标签后保留空格，避免 CommonMark 把标点相邻的 `**` 当作字面文本。

已执行：

- `npm run typecheck`、`npm run test -- --run`：39 个文件、356 项通过；新增 8 项构建契约用例覆盖章节/段落/引用/表格、共享键位展开、真实手册及锚点/占位符/原始 HTML 拒绝。排版调整后再次执行构建用例和路由用例，54 项通过。
- `npm run build` 通过；构建目录无 `.md` 资产。构建配置使用显式 TS 扩展名和 JSON import attributes，无新增配置加载警告。
- 生产预览服务 5198 上 `HANDBOOK_PRODUCTION=1 npm run test:handbook`：Chrome 147.0.7727.101，覆盖原首次提示/账号隔离/设置入口/新标签页/目录/刷新/窄屏检查，并确认 Markdown 分隔符没有显示为正文、`.md` 请求数为 0；无 pageerror 或意外 API。
- 前端生产/配置/构建代码共 106 个 TS/TSX 模块的相对 import/from DFS（含 type imports）无循环。构建器只引用内容类型契约，运行时页面不反向导入构建器。`git diff --check` 通过。

页面截图仍由同一浏览器脚本写入 `/tmp/cuerelay-handbook/`。内容没有新增功能或改变已确认状态，不涉及后端/数据库迁移；升级环境运行前端 `npm ci` 后重新构建部署。
