# 前端路由与项目导航执行计划

2026-10-24，用户已批准方案。保持后端公开 API 和工作区数据契约；不新增草稿持久化或标签页同步。

1. 建立 navigation：统一路由解析/生成、原生链接与 History API。受保护的 popstate 先恢复当前条目，再由应用确认原历史跳转。
2. 提取 app-workspace：单个保留工作区的生命周期、项目加载、创建 File 交接、保存和归档观察。字幕/草稿仍唯一属于 EditorWorkbench。
3. 接入 App 与项目列表：明确 URL 优先于默认组织；登录保留目标；新标签页列表不改变原工作区；创建前确认旧内容保护。
4. 增补浏览器回归、开发/构建深链接验证及生产 Nginx 示例，隔离 /api、/admin、/static、/assets。
5. 执行相关测试、类型检查、构建，更新 architecture/projects/模块 README/运行文档与实际验证记录。

路由：`/`、`/projects` 为入口；`/organizations/:organizationId/projects` 为列表；`/organizations/:organizationId/projects/:projectId/workspace` 为项目工作区；`/workspace/local` 为本地工作区。无匹配显示页面不存在。列表筛选维持页面内状态。

边界：同组织列表保留单个工作区；同标签页隐藏工作区继续暂停播放和快捷键。新标签页链接不改变原页 visible。切换项目/组织/账号、本地工作区和重载继续导出/取消/明确放弃；实际离页保留 beforeunload。历史记录仅含导航位置标记，不保存 File 或正文。

验证结果与剩余限制在完成时记录于 docs/experiments/frontend-navigation.md。

已完成：上述五项实现、模块/架构/运行文档与本机自动验证。前端单元/类型/构建、59 项后端测试、dev/preview 导航、项目/音频集成及构建时间轴回归均已执行。生产 Nginx/TLS 与其他浏览器尚未验收，不能把本机 preview 等同于生产部署通过。
