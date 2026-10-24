# 当前列表中的单页创建弹窗

2026-10-24。替代 [此前的新建项目标签页方案](tab-navigation.md)，其他页面链接的新标签页规则不变。

## 行为与职责

- 「新建项目」属于列表操作，使用按钮打开本地弹窗，不改变 URL 或新增标签页。名称、说明、视频和空字幕/ASS 在同一表单填写，不再分步。
- ProjectsPanel 拥有弹窗状态，ProjectForm 拥有字段、文件引用和预检；App 仍负责已有工作区的导出/取消/明确放弃保护。创建成功后 adoptCreated 接收原 File，再 push 工作区 URL；回退回到原列表，前进复用当前内存工作区。
- 原问题在修改前通过 Chrome 复现：文件 input 的 cancel 事件冒泡到 dialog，Modal.onCancel 把它误判为关闭整个弹窗。现在只处理 target=currentTarget 的弹窗自身取消；空文件 change 也保持原选择和字段。明确取消和真正的弹窗 Escape 仍关闭，校验或提交期间不能误关。
- 网络失败、非法 ASS 和重新聚焦保留表单，允许核对后重试；不新增草稿持久化、跨标签页传 File 或同步。旧 `/organizations/:organizationId/projects/new` 地址规范到对应列表，不自动打开表单。

## 已执行验证

- `npm run typecheck`、`npm run test -- --run`：20 个文件、200 项单元测试通过，包含旧地址规范化。
- `npm run build`：通过。
- Chrome 147.0.7727.101，独立 PostgreSQL 测试库 `cuerelay_navigation_browser_1792818164541871000`，真实 Session/CSRF 与项目接口。
- `project-form.mjs`：4 组通过。覆盖同页弹窗/无下一步、空文件选择和 input cancel 冒泡、已选视频/ASS 取消后仍可用、非法 ASS、重新聚焦、选片后编辑字段、提交期间 Escape、503 失败保留并重试、原 File 直接可编辑、前进/回退和旧地址兼容。
- `tab-navigation.mjs`：5 组通过。创建已改为同页弹窗，继续覆盖其余默认新标签页、组织上下文、设置、原工作区字幕/视频/播放位置保留、错误返回和取消切换。
- `navigation.mjs`：13 组通过。覆盖创建/历史、直接访问/刷新/登录继续、403/404/归档/503、旧稿保护、beforeunload 和 API/Admin 隔离。
- `projects.mjs`：8 组通过。覆盖创建预检、保存与 revision 冲突、重载保护、归档恢复、成员权限和分页。
- 已查看 1440px/390px 表单截图，均无横向溢出。
- `npm run test:project-form` 在 frontend 工作目录复跑通过；4 个相关浏览器脚本的 `node --check` 通过。扫描 76 个 TS/TSX 文件无相对 import 环，`git diff --check` 通过；未新增跨模块依赖。
- 已停止本轮隔离服务、删除临时数据库及凭据。日常 5173/8000 服务保留运行；5173 首页、设置、旧创建深路径均返回前端 HTML，Session 为 JSON，Admin 登录正常，均为 HTTP 200。

截图及脚本输出目录位于系统 TMPDIR：`cuerelay-project-form-2sGJ46`（frontend npm 命令复跑为 `cuerelay-project-form-nnM0z8`）、`cuerelay-tab-navigation-dvdZnI`、`cuerelay-navigation-faHQ52`、`cuerelay-projects-kgg6Rm`。

## 复跑与限制

按 [前端部署](../frontend-deployment.md) 准备一次性测试库，设置相同的 `BROWSER_TEST_PASSWORD` 和 `PROJECTS_URL` 后，在仓库根执行 `node frontend/browser-tests/project-form.mjs`，或在 frontend 执行 `npm run test:project-form`。

脚本拦截浏览器文件选择并测试空选择，同时派发与原问题一致的冒泡 cancel 事件；没有自动操作原生 macOS Finder 窗口。未运行 Safari/Firefox、生产 Nginx/TLS 或后端单元测试（本轮无后端修改）。取消整个创建弹窗或刷新页面不保存表单草稿，沿用既有内存状态边界。
