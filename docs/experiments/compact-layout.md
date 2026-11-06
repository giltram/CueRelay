# 紧凑顶栏与工作区验证

2026-11-06，macOS / Chrome 147.0.7727.101 / Node 26。保留任务开始前的诊断导出与字幕查找改动；未提交、未发布。浏览器使用合成 MP4 与隔离 HTTP 夹具，预览套件使用真实后端无状态 ASS 转换，未写开发业务数据库。

## 结果

- `npm run typecheck`、`npm test -- --run`（340 项 / 38 文件）、`npm run build` 通过。既有 boundaries.test.ts 同时验证 diagnostics 叶子边界及所有前端相对源文件导入无循环。
- `node browser-tests/compact-layout.mjs` 通过：1440×900 下顶栏固定 44px，入点/出点/样式同一行；仅顶栏和上方编辑区域尺寸调整就让字幕列表从 322px 增至 386px（+64px）。选片完整验证、修改、保存冲突、保存成功及预览反馈均不改变该高度。
- 同套件覆盖 1024×768、1440×600、390×844；顶栏不换行增高，窄屏工具栏与编辑控件局部横向滚动，页面无横向溢出。列表、个人/组织设置、项目设置、未知路由、登录/初始化共用顶栏。未登录会话失败仍有可见错误与重试，登录表单错误位于顶栏。
- 诊断导出只在个人设置正文；指定的选片提示及认证凭证半句均已删除。真实下载有效 JSON、账号信息、下载失败顶栏提示及恢复重试通过；隐藏工作区的状态/消息不混入设置页，同文档历史返回保留字幕及媒体实例。
- `npm run test:subtitle-search` 通过：查找、定位、IME、撤销及弹窗/可见性保护继续生效。
- `npm run test:personal-settings-pending` 通过：请求期间全部相关控件禁用，成功确认提交版本，失败保留草稿并恢复输入。断言通过命名的“个人设置反馈”定位，避免把新增的顶栏组织状态误当成保存状态。
- `DIAGNOSTICS_URL=http://127.0.0.1:5196 npm run test:diagnostics` 在干净 Vite 进程通过：下载、IndexedDB/内存降级、1800 条预算与最后记录持久化、跨账号隔离、延迟保存失败的原始账号/组织归属。底层下载直接调用，UI 入口及重试由紧凑布局套件覆盖。持久化重建 recorder 的测试补齐组织上下文；热更新导致的重复模块实例仍需按原诊断文档使用干净服务排除。
- `ASS_PREVIEW_URL=http://127.0.0.1:5196 npm run test:ass-preview` 通过：真实 JASSUB 绘制、暂停/非帧对齐边界、样式更新、合并输入、恢复、全屏及项目切换。原快速输入场景在点击首行后会定位 1.20s，却要求 2.80s 才出现的重叠黄字；测试补充显式 seek(2.8)，保留原像素断言和生产选行行为。预期的 422/Worker 失败故障注入不算应用错误。
- `git diff --check` 通过。

`npm run test:navigation` 因缺少 BROWSER_TEST_PASSWORD / 可丢弃数据库夹具未执行场景；没有为它改动开发数据库。紧凑布局和字幕查找套件已覆盖同标签页设置导航、隐藏工作区与历史恢复。Safari/Firefox 未验证。

截图与报告临时目录：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-compact-layout-RG2hrf`；预览：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-ass-preview-eQYUgk`。目录可能被系统清理，脚本可重跑。

## 架构检查

新增 page-ui 仅组合页面壳和本页 portal 目标，无业务状态、请求、全局消息队列或反向依赖。diagnostics 下载按钮用 onError 回调把提示交给 SettingsPage，保持其叶子约束。弹窗确认/校验继续留在 dialog，字幕数据、权限、媒体验证、保存 revision 和编辑历史契约不变。没有需要在本任务额外实施的架构重构。
