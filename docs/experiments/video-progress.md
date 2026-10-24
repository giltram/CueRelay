# 视频独立进度条

2026-10-24：关闭 LocalVideoPlayer 的原生 controls，在视频画面与原有播放 / 时间 / 导入栏之间增加 range 进度条，不添加音量等按钮，不恢复字幕预览功能。

进度条接收 EditorWorkbench 的 currentTime / duration（毫秒），无媒体时禁用。点击、拖动、原生键盘方向键 / Home / End 经 onSeek 调用工作区的 seekPlayback，与 AudioTimeline 共用同一入口：取消试听、调用 media.seekVideo 并立即同步显示时间，保留播放 / 暂停状态，不修改字幕草稿。进度条使用原生 input，沿用现有焦点过滤，因此聚焦时 Enter / Space / G 不触发打轴动作。实际播放位置始终由同一个 video 提供；视频事件继续同步时钟与进度条。

CSS 的 --video-controls-space 从 44px 调整到 68px，同时供视频尺寸与分栏上限测量使用；窄屏滚动预留也增加 24px，保持视频 16:9，控件位于画面外。

## 验证

- `npm run build`：通过，包含 TypeScript 检查。
- `npm test -- --run`：22 个文件、208 项通过。
- `VIDEO_PROGRESS_URL=http://127.0.0.1:5184 node browser-tests/video-progress.mjs`（frontend 目录）：Chrome 147.0.7727.101 通过。合成 12 秒带音频 MP4、真实媒体播放与音频分析，模拟账号 / 空文档接口，无数据库写入。
- 浏览器覆盖未加载禁用、原生 controls 关闭、原时间格式、点击 / 拖动暂停定位、方向键 / 首尾定位、输入焦点不误触发快捷键、手动跳转取消试听且继续播放、音频播放头同步、外部 seek 和播放按钮同步，以及 1440 / 1000 / 390px 布局与 video 节点复用。无页面异常或非预期 API 请求。
- 截图目录位于系统 TMPDIR 的 `cuerelay-video-progress-06qhci`，已查看桌面和手机宽度截图。
- `git diff --check`、浏览器脚本语法检查通过；扫描 81 个 TS/TSX 文件的静态相对 import，无环，新增依赖保持 workspace-ui → media。

复跑：启动前端后在 frontend 执行 `npm run test:video-progress`；默认地址为 5173，可通过 VIDEO_PROGRESS_URL 更改。需要 Chrome 和 FFmpeg。未实测 Safari / Firefox 或真实触屏；没有后端修改，未运行后端测试。
