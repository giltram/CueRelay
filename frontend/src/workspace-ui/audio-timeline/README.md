# 音频时间轴

`AudioTimeline` 只接收 File、既有 video、毫秒时间 / 时长、字幕草稿与动作回调，不持有字幕文档，不自行播放声音。

显示模式是受控 mode 属性，由 EditorWorkbench 默认设为 Spectrum，暂在顶栏 ASS 导入导出旁切换；后续计划迁至个人设置，不在此组件持久化。音频区域不再有标题 / 模式 / 缩放 / 当前工具栏，原高度全部给画布。普通滚轮（纵向或横向）平移，Shift+滚轮缩放；wheelViewport 统一指针锚点、边界约束与 deltaMode 单位。

- `viewport.ts`：秒坐标、0.5–60 秒视窗、以指针为锚的缩放、平移边界；`xAtTime` 是标尺、频谱和 DOM 覆盖线共用的时间到位置映射。
- `ruler.ts`：纯函数负责 Aegisub 3.2.2 八档刻度、整数毫秒 tick 索引、相对上一条实际显示标签的前缀省略、测量避让；仅计算可见视窗。
- `draw-ruler.ts`：在原 canvas 顶部 22px 内绘制黑底蓝字、6px / 4px 刻度与一物理像素底线；不拥有视窗或交互状态。
- `draw-audio.ts`：canvas 像素绘制，合并峰值桶；不解码媒体、不修改状态。
- `AudioTimeline.tsx`：模式 / 视窗、pointer / wheel 生命周期，原 video 播放头和边界叠加。
- `AudioBoundary.tsx`：有 pointer capture 的可访问边界滑块；拖动及方向键将时间吸附到 10ms，Shift 方向键为 100ms。仅更新 EditorWorkbench 的 changeTimeDraft；G / 应用时间仍通过原 applyTimes 提交。逆序等草稿继续由原校验拒绝，未绕过字幕契约。
- `draw-spectrum.ts`：仅绘制 Worker 的时频能量；每个组件持有 WeakMap 图像缓存，随可见 tile 释放，不创建全局缓存。减小渐进返回 tiles 时的重复像素转换。
- `media/audio/use-audio-analysis.ts`：Worker 会话与陈旧结果隔离，视图仅接收当前窗口的分析 tiles。

播放头 RAF 只更新一条 DOM 线，波形仅在数据 / 视窗 / 尺寸变化时重绘。视窗在无视频元数据时不被跟随逻辑重置。字幕行选择可移动视窗，输入时间草稿不会重置缩放或平移。已有 seekVideo / EditorWorkbench 的操作仍是播放和字幕状态入口。

本目录 viewport 测试覆盖坐标不变量；完整页面交互见 `frontend/browser-tests/audio-timeline.mjs`。布局继续使用项目 CSS 变量和原音频占位的空间。

## Aegisub 标尺契约

参考 [3.2.2 AudioDisplayTimeline 的 ChangeZoom / Paint](https://sources.debian.org/src/aegisub/3.2.2%2Bdfsg-3/src/audio_display.cpp/)。保留现有频谱绘制与 0.5–60 秒缩放范围，只替换原重复全时间标签和纵向网格。按像素每秒选择绝对时间刻度；225px/s 对应 100ms 短刻度 / 1s 长刻度，500px/s 对应 10ms / 100ms，20px/s 对应 1s / 10s。标尺与频谱、播放头、字幕边界共用 `AudioViewport`，不引入滚动状态。

按任务要求，首个完整显示的标签始终包含小时（例如 `0:00:05`），而非源码中短音频可省略小时的行为；其后按已绘制标签省略重复小时 / 分钟。秒补两位，小数精度为 1 或 2 位。`measureText` 检查完整文字与 4px 间距；碰撞或右侧裁剪时只跳过文字，不跳过刻度，也不更新前缀上下文。极窄窗口允许没有能完整容纳的标签。

Canvas 采用 getBoundingClientRect 的小数 CSS 尺寸，与 DOM 覆盖线一致；backing store 按完整 DPR 取整后，用实际横纵比例映射回 CSS 坐标，避免 clientWidth 取整造成位置偏差。ResizeObserver 和 resolution 媒体查询分别触发尺寸 / 屏幕 DPR 改变后的重绘。纯函数回归见 `ruler.test.ts`；`browser-tests/ruler-checks.mjs` 由既有 audio-timeline 浏览器回归调用，验证真实画布文字、缩放、滚动、resize / DPR 和点击标尺定位。字体采用现有 11px 等宽字体，不保证与 Aegisub 平台原生字体逐像素一致。

空文件、读取中、分析中与错误状态只占音频区域。输入非法时间时暂不绘制边界，保留编辑器原文；切文件时不显示旧数据。窗口结束点包含视频结束时刻，避免暂停在片尾时反复触发跟随重绘。
