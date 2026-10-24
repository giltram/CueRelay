# 默认新标签页与组织切换范围

2026-10-24。此记录为此前导航规则的验证；新建项目的独立标签页方案已由 [单页创建弹窗](project-form.md) 替换，其他页面导航规则保留。

## 最终行为与职责

- RouteLink 默认真实 `_blank` 链接，使用 `noopener noreferrer`；项目列表、项目名称、打开/只读查看、本地工作区、设置和设置分类均新开标签页。只有 CueRelay 首页链接与错误状态返回列表/选择组织显式 `_self`。组织选择留在当前页。
- 组织下拉框仅在首页和组织项目列表出现；工作区、设置、创建页及错误页均不显示切换器。
- 新建链接打开 `/organizations/:organizationId/projects/new`，App 按路由传 creating 给 ProjectsPanel，复用 ProjectForm。在创建标签页内选片并创建，再 adoptCreated 进入同页工作区；创建条目替换为列表再 push 工作区，因此回退返回列表。来源页不变，也无需跨窗口传递 File 或同步稿件。
- `/organizations/:organizationId/settings/personal` 和 `/organizations/:organizationId/workspace/local` 显式延续非默认组织上下文；原 `/settings`、`/workspace/local` 仍可直达。地址仍只包含页面和资源标识。
- 新开普通项目工作区独立加载服务器快照，仍需重新选择并核对视频。来源页的字幕、时间输入、视频和播放不被新标签页导航改变。只有同文档历史浏览列表/设置才隐藏并暂停其保留实例；现有 beforeunload、账号/组织替换和 revision 冲突保护保留。

路由规则属于 navigation，数据及单工作区实例属于 app-workspace，设置布局属于 account-ui；没有后端/API/数据库模型、自动保存、草稿持久化或跨标签页同步改动。

## 已执行验证

- `npm run typecheck`、`npm run test -- --run`：20 个文件、200 项单元测试通过，包含默认 target/rel、当前页例外/修饰键、创建和组织上下文路由。
- `npm run build`：通过。
- Chrome 147.0.7727.101，真实 Session/CSRF/PostgreSQL；独立 `cuerelay_users_browser_1792815954681593000` 与 `cuerelay_navigation_browser_1792815954681593000`，未修改现有开发数据。完成后已停止临时服务、删除两个数据库和临时凭据。
- `tab-navigation.mjs`：5 组通过。普通点击实际新开、opener 隔离、非默认组织保持、仅列表有切换器、设置分类新开且原表单输入保留、新建页复用已选 File、创建后的回退/前进、原视频继续播放/字幕/时间草稿保留、普通项目新开/刷新独立选片、CueRelay 与错误返回例外、取消组织替换和归档只读。
- `navigation.mjs`：13 组通过。显式同页导航保留历史/资源替换保护，以及原生新开、直达/刷新/登录继续、403/404/归档/503、beforeunload、API/Admin 隔离。历史测试通过 link-navigation.sameTab 显式覆盖 target；默认普通点击规则由 tab-navigation 独立验证。
- `projects.mjs`：8 组通过，覆盖创建、视频摘要、保存/revision 冲突、重载导出/取消、归档恢复、成员保存和分页。
- `user-system.mjs`：9 组通过，覆盖密码/快捷键保存、成员权限/最后管理者约束、跨标签页会话失效、账号/组织切换和退出保护。
- `main-audio-integration.mjs`：4 组通过，覆盖视频匹配、音频时间草稿、个人快捷键、隐藏实例与归档只读。
- 查看桌面工作区、桌面/390px 设置截图；默认标签页实测无页面脚本错误。扫描 76 个 TS/TSX 文件无相对 import 环，`git diff --check` 通过。
- 日常开发入口 5173/8000 保留运行；请求新增创建/个人设置/本地工作区深路径返回前端 HTML，Session JSON 和 Admin 登录页正常。

最终截图位于系统 TMPDIR 的 `cuerelay-tab-navigation-fQFbQl`、`cuerelay-navigation-VoUkoE`、`cuerelay-projects-ObL0kB`、`cuerelay-users-browser-E9NVhp`、`cuerelay-integration-P5lBrN`。

## 运行与限制

按 [前端部署](../frontend-deployment.md) 准备一次性项目测试库，在相同 BROWSER_TEST_PASSWORD 环境执行 `PROJECTS_URL=... npm run test:tab-navigation`（frontend 目录），或从仓库根执行 `node frontend/browser-tests/tab-navigation.mjs`。既有保护脚本仍使用其原测试库和命令。

本轮未执行后端单元测试（无后端改动）、preview、生产 Nginx/TLS、Safari/Firefox 或真实片源验收。新标签页是否前台显示由浏览器偏好决定；应用使用原生链接，不强制聚焦。设置保存后，其他已打开标签页沿用既有重新聚焦/30 秒会话与设置检查，没有新增实时同步机制。
