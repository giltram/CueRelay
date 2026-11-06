# 鼠标边界吸附验证

日期：2026-11-07。此前仅做 10ms 网格取整，没有邻近标记吸附。

实现契约与 Aegisub 源码依据见 [时间轴模块](../../frontend/src/workspace-ui/audio-timeline/README.md)。默认 8 CSS px 最近标记吸附，Shift 临时取消；支持其他字幕边界、当前草稿另一端和显示播放头。无关键帧数据，未实现关键帧吸附。草稿、历史、提交和权限仍由工作区原接口拥有。

已执行：

- `cd frontend && npm test -- --run src/workspace-ui/edit-history.test.ts src/workspace-ui/commit-timing.test.ts src/workspace-ui/timing-shortcuts.test.ts src/workspace-ui/audio-timeline`：8 文件、102 项通过。
- `cd frontend && npm run typecheck`、`npm run build`：通过。
- `cd frontend && npx vite build --outDir /tmp/cuerelay-boundary-snap-dist`：通过。
- 用 Vite preview 在 5195 提供上述产物，执行 `BOUNDARY_SNAP_URL=http://127.0.0.1:5195/workspace/local node browser-tests/boundary-snap.mjs`：Chrome 147.0.7727.101 通过；验证左右键点击、两端拖动、Shift 取消、超出 8px 不吸附、缩放 / 平移后的固定像素范围、另一端草稿 / 播放头目标、一次拖动一步撤销 / 重做、方向键 10/100ms 不吸附，以及提交前已保存行 / 视频时间 / 点击时视窗不变。无 pageerror 或意外 API 请求。

浏览器使用 FFmpeg 合成视频与隔离 HTTP fixture，不写开发数据库；字幕预览导出明确返回 503，由既有 unavailableAssPreview 夹具隔离。开发服务器本次遇到 fft.js 依赖加载中断，因此实际浏览器验收使用生产构建产物。手册已有的空二级标题阻止 Markdown 编译，移除无内容标题后恢复；其他手册编辑保留。未进行真实片源制作验收。
