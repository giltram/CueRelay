# 独立设置页面验证

2026-10-24。以下记录为独立设置页初版；后续默认新标签页及仅列表换组织已由 [标签页记录](tab-navigation.md) 更新。

移除「返回工作区」，项目列表右上角统一通过真实链接进入设置；个人 `/settings`，组织 `/organizations/:organizationId/settings`。设置布局由 account-ui/SettingsPage 组合原 PersonalPanel / MembersPanel；App 保留上下文和工作区保护，navigation 唯一定义路径。无后端/API/数据模型改动。

## 已执行

- `npm run typecheck`、`npm run test -- --run`：19 个文件、192 项测试通过，包含新增设置路由生成/解析、非法组织 ID 和显式组织身份检查。
- `npm run build`：通过。
- Chrome 147.0.7727.101，真实 Session/CSRF/PostgreSQL，分别新建 `cuerelay_users_browser_1792812498693384000` 和 `cuerelay_navigation_browser_1792812498693384000`。所有播种、密码/成员修改及项目写入仅发生在临时数据库，没有修改现有开发数据。验证后已停止临时服务并删除这两个数据库及临时凭据。
- `user-system.mjs`：9 组通过。密码确认/错误/成功清空、快捷键保存/恢复/刷新、organizer/member 权限和最后管理者保护、移除确认/取消、隐藏工作区的退出/组织/账号保护、同账号恢复及无组织状态。
- `navigation.mjs`：13 组通过。设置真实链接与独立 URL、深链接登录/刷新保持指定组织、中键新开无编辑器、无组织/不可访问组织提示、浏览器回退恢复 video 节点/播放位置/字幕/时间输入、设置期间快捷键暂停；原项目创建 File 交接、历史保护、403/404/归档/503、beforeunload 和 API/Admin 隔离继续通过。
- `projects.mjs`：8 组通过。改用项目名称/打开链接返回后仍保留内存状态；创建、保存/revision 冲突、重载保护、视频摘要、归档/恢复、分页及普通成员保存通过。
- `main-audio-integration.mjs`：4 组通过。设置页暂停隐藏工作区的提交/删行，回退后生效新快捷键；媒体匹配、手动保存不含时间草稿、隐藏实例和归档只读继续通过。
- 查看 1360px 桌面和 390px 窄屏个人/组织设置截图，布局正常；浏览器测量无页面横向溢出。
- 扫描 75 个 TS/TSX 文件的相对 import 图无环，`git diff --check` 通过。未引入 workspace-ui 到 navigation/account-ui 的反向依赖。

截图位于本机临时目录：`cuerelay-navigation-WY7Anu`、`cuerelay-users-browser-FmhAyX`、`cuerelay-projects-npDlKe`、`cuerelay-integration-l5dHKI`（系统 TMPDIR 下）。测试脚本输出具体绝对路径。

## 边界

设置分类/其他页面导航不自动保存未提交的密码或快捷键输入，沿用原弹窗关闭即丢弃输入的边界。工作区本地内容在同一文档内保留；刷新及新标签页仍独立，不新增草稿持久化。普通进入设置会隐藏并暂停视频，回退恢复播放位置，不自动恢复播放。

此次执行开发服务上的 Chrome 回归；未重跑后端单元测试（无后端改动），未执行 preview、生产 Nginx/TLS、Safari/Firefox 或真实片源验收。现有 SPA fallback 支持新增路径，部署验收步骤见 [前端部署](../frontend-deployment.md)。

## 组织设置路径统一

2026-10-24：组织设置规范地址改为 `/organizations/:organizationId/settings/organization`，与个人设置的 `/settings/personal` 对称。旧 `/organizations/:organizationId/settings`（含尾斜杠）仍解析为组织设置，由 App 既有规范化流程 replace 到新地址，不增加历史条目。全部链接继续由 navigation.routePath 生成，无新增模块依赖。

本轮执行 navigation 的 routes / history-navigation / RouteLink 测试，3 文件 38 项通过；typecheck、build、两份导航浏览器脚本的语法检查及 `git diff --check` 通过。独立 Chrome 检查使用模拟只读 API 与临时 Vite 服务，验证新链接、当前页分类切换、刷新、前进/回退、两种旧地址 replace 跳转和非默认组织上下文，无页面异常或意外 API 请求。既有 navigation.mjs 已补充旧地址跳转断言；本轮未重跑依赖真实数据库的完整导航脚本。
