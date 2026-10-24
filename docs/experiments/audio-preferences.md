# 音频显示移至个人设置

2026-10-24。工作区顶栏的 Waveform / Spectrum 按钮及空分组样式已删除。个人设置新增「音频显示」，显式选择并保存模式，默认 Spectrum。

## 契约与实现

- accounts.PersonalSettings 增加 audio_display_mode；waveform/spectrum，默认 spectrum，choices 与数据库检查约束限定取值。迁移 accounts.0004 只加新字段和约束。
- 既有 GET /api/me/settings 增加此字段，PATCH 接受 shortcut_overrides / audio_display_mode 的非空子集；未提交字段保持，旧快捷键请求兼容。先验证全部字段再写入，非法组合不能部分提交。Session、CSRF 和账号一致性保护保持。
- PersonalPanel 分别保存显示模式与快捷键；失败保留输入且不向 App 应用失败值。App 通过既有设置加载、focus/visibilitychange 和 30 秒检查取得服务端偏好。
- EditorWorkbench 接收 audioMode，再传给 AudioTimeline.mode；不拥有模式副本、不访问账号 API。切换复用当前 File、video、视窗、音频 Worker 与 PCM 缓存，不改字幕或未应用时间。
- 设置仍默认新开标签页。保存后回到原工作区即可应用；没有新增窗口消息、Storage、草稿持久化或实时同步机制。

## 已执行

- 前端 `npm run typecheck`、`npm run test -- --run`（20 文件、200 项）、`npm run build` 均通过。
- 后端 `manage.py test accounts ass_format http_api organizations projects --noinput`：63 项通过，真实 PostgreSQL。新增检查默认/持久化/账号隔离、部分更新保留另一字段、非法类型/值及未知字段拒绝、失败无部分写入、数据库约束和旧记录迁移默认值；原密码、权限、项目及 ASS 测试继续通过。
- Chrome 147.0.7727.101，独立数据库 `cuerelay_navigation_browser_1792816662725421000`，真实 Session/CSRF/API。测试后已停止临时服务并删除该库和临时凭据，5173/8000 日常服务继续运行。
- `audio-preferences.mjs`：4 组通过。按钮确已离开工作区；真实设置新标签页保存/刷新/失败保留/账号隔离；两类设置分别保存不互相覆盖；原 video/时间轴节点、字幕/时间草稿/选中行/播放位置/视窗/PCM 解码计数保持；播放中应用另一模式继续播放。1440px/390px 截图已查看，窄屏无横向溢出。
- `audio-timeline.mjs`：完整合成音频回归通过。模式通过设置 UI 切换；波形/频谱像素、PCM 复用、缩放平移、播放头拖动/取消/媒体终点、边界定时、提交/删行、输入/IME/原生按钮焦点、刻度/DPR/窄屏及缓存上限均通过，无页面错误/媒体上传。前台视窗压力段最大心跳间隔约 43.66ms，无 long task。设置新标签页停留时间不计入前台 Worker 性能采样。
- `navigation.mjs`：13 组通过，包含新的持久化显示模式下保留实例、历史保护、独立标签页、权限/归档/加载失败及 beforeunload。
- `main-audio-integration.mjs`：4 组通过，包含视频匹配、时间草稿与手动保存、快捷键设置、隐藏实例及归档只读。
- 76 个 TS/TSX 文件的相对 import 图无环，`git diff --check` 和更新脚本的 Node 语法检查通过。
- 当前开发库已应用 accounts.0004，`migrate --check`、`makemigrations --check --dry-run` 和 Django check 均通过。迁移前后比较已有 PersonalSettings 全部旧列（含快捷键和 updated_at）的摘要一致，后端已重启到新版本。

截图和报告位于系统 TMPDIR：`cuerelay-audio-preferences-w5EBdq`、`cuerelay-timeline-DdgRdB`、`cuerelay-navigation-GXaIdY`、`cuerelay-integration-lyjikZ`。

## 运行与限制

升级先按根 README 载入 .env，执行 `python backend/manage.py migrate`，再同时发布前后端。旧账号没有设置记录时仍返回默认 Spectrum，不隐式创建记录。回滚本迁移会删除新增显示偏好字段，保留旧快捷键。

一次性浏览器库沿用项目播种脚本和 [前端部署](../frontend-deployment.md) 的准备步骤。设置 BROWSER_TEST_PASSWORD / PROJECTS_URL 后，从 frontend 执行 `npm run test:audio-preferences`；完整音频回归使用 AUDIO_TIMELINE_URL 和 `npm run test:audio-timeline`。

本轮未执行 Safari/Firefox、生产代理/preview、大型真实片源，未重跑 user-system.mjs/projects.mjs/tab-navigation.mjs；当前结果不代表这些检查通过。已打开的其他标签页通过既有焦点/30 秒检查取得偏好，没有即时广播。偏好属于账号；同账号不同工作区共用同一显示选择。
