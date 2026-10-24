# 音频 Vertical Zoom

2026-10-24。沿用现有 Canvas / Worker 架构，只改 `workspace-ui/audio-timeline`；无新依赖、后端字段或账号持久化。右侧竖直滑块参考 [Aegisub AudioBox](https://github.com/TypesettingTools/Aegisub/blob/master/src/audio_box.cpp) 的摆放与向上增强交互，不复制其立方增益 / 音量联动。

## 显示契约

- 本地 `verticalZoom` 默认 1.0，范围 0.5–4.0，步长 0.01；支持实时鼠标拖动、键盘、双击恢复默认。同一实例内切换 File、模式或水平视窗均不重置；整个工作区重新挂载后回到默认。
- 频谱沿用 Worker 固定 -80..0dBFS 的 Uint8 能量；归一化后用 `e ** (1 / verticalZoom)` 调整色表位置，保留原 normal / inactive / active 调色板。默认值为恒等映射，静音与满量程固定，较大值提升弱信号而不对一整段强信号硬截顶。原阈值以下数据已量化为零，显示调整不能恢复这些信号。
- 波形将已有 min/max 峰值的显示高度乘以 zoom，限定在波形区域内。播放音量、进度、频率 / 时间坐标和字幕标记不变。
- 每 tile / 当前物理高度复用 Uint8 显示能量和一份 ImageData，三种色表各保留一张 canvas 及其最新 zoom；不按所有历史 zoom 增长缓存。仅高度 / DPR 改变时重新采样，zoom 变化只建立小型 256 项色表并覆写缓冲。RAF 合并最新重绘，主画布尺寸未变时不重新分配 backing store。

## 实际执行

- `cd frontend && npm run test -- --run`：22 个文件、235 项通过，包括亮度方向、逐步变化、三色表端点、频率方向、数据不变和重复着色。
- `cd frontend && npm run build`：TypeScript 与 Vite 生产构建通过。
- `cd frontend && node browser-tests/vertical-zoom.mjs`：Chrome 147.0.7727.101 通过。默认连接开发服务 5173，可用 AUDIO_TIMELINE_URL 指定其他服务。浏览器内 API fixture 隔离账号 / 数据库；FFmpeg 合成 45 秒 AAC 音轨，含 1kHz 弱音、3kHz 强音及静音段；音轨使用真实 WebCodecs / Worker / Canvas。
- 验证向上拖动增强、向下减弱，松开鼠标之前已重绘；Home / End、ArrowUp / ArrowDown、双击恢复，以及恢复后像素与原默认图一致。活动 / 普通区间信号提亮，静音的区间背景保持原色。波形在 4.0 / 0.5 时的可见峰值跨度为 135 / 17 物理像素。
- 一轮上下拖动及键盘 / 复位前后：Worker 始终 1 个、发送消息始终 2 条、ImageData 分配始终 5 次、解码段始终 6、分析缓存始终 2,980,864 字节。显示确实更新，时间视窗、视频 currentTime / volume、字幕草稿和边界位置均未改变。
- 模式来回切换、Shift+滚轮水平缩放及 800×900 窄屏通过。复用既有 `checkPlayhead` / `checkRuler`：暂停 / 播放中定位、左右越界、取消拖动、片尾 45s、标尺定位 / 平移 / 缩放及 DPR 3 / 1.25 / 1 均通过。页面错误与意外 API 请求均为零。
- 对 AudioTimeline 的相对 TypeScript 依赖遍历覆盖 16 个模块，未发现循环；未新增 media → UI 依赖。`git diff --check` 通过。

已查看 default / bright / dim / narrow 实际截图，右侧控制区与画布分开，共用原深色样式。真实语音与其他浏览器尚未人工验收；生产页面仍保持选片后固定片源，本次没有新增换片入口，File prop 更新时保留 zoom 的行为由现有组件状态生命周期保证。
