# 音频时间轴

`AudioTimeline` 只接收 File、既有 video、毫秒时间 / 时长、字幕草稿与动作回调，不持有字幕文档，不自行播放声音。

- `viewport.ts`：秒坐标、0.5–60 秒视窗、以指针为锚的缩放、平移边界及刻度间距。
- `draw-audio.ts`：canvas 像素绘制，合并峰值桶；不解码媒体、不修改状态。
- `AudioTimeline.tsx`：模式 / 视窗、pointer / wheel 生命周期，原 video 播放头和边界叠加。
- `media/audio/use-audio-analysis.ts`：Worker 会话与陈旧结果隔离，视图仅接收当前窗口的分析 tiles。

播放头 RAF 只更新一条 DOM 线，波形仅在数据 / 视窗 / 尺寸变化时重绘。视窗在无视频元数据时不被跟随逻辑重置。字幕行选择可移动视窗，输入时间草稿不会重置缩放或平移。已有 seekVideo / EditorWorkbench 的操作仍是播放和字幕状态入口。

本目录 viewport 测试覆盖坐标不变量；完整页面交互见 `frontend/browser-tests/audio-timeline.mjs`。布局继续使用项目 CSS 变量和原音频占位的空间。
