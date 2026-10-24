# 音频时间轴

`AudioTimeline` 只接收 File、既有 video、毫秒时间 / 时长、只读 cues、字幕草稿与动作回调，不持有字幕文档或历史副本，不自行播放声音。

显示模式是受控 mode 属性，由 App 的账号设置经 EditorWorkbench 传入，默认 Spectrum；选择和显式保存入口位于个人设置的「音频显示」，工作区不提供切换器。mode 更新只改变分析/绘制请求，不重置坐标、File、video 或已有 PCM；本组件不请求账号设置或持久化偏好。音频区域不再有标题 / 模式 / 缩放 / 当前工具栏，原高度全部给画布。普通滚轮（纵向或横向）平移，Shift+滚轮缩放；wheelViewport 统一指针锚点、边界约束与 deltaMode 单位。

Spectrum 本体（22px 标尺以下）左键单击设置入点草稿，右键按下设置出点草稿并阻止原生右键菜单；坐标复用 timeAtX / boundaryTime，吸附到既有 10ms 网格。右键使用 PointerEvent 的小数坐标，contextmenu 仅负责阻止菜单，避免该 MouseEvent 坐标取整引起一格偏差。左键移动超过 3px 仍为平移，不会顺带设置入点。播放头 / 入点边界的左键拖动优先，出点边界仅右键拖动，标尺与 Waveform 仍单击定位视频。

onBoundaryChange 是统一的时间草稿回调：ASS 文档就绪、canEdit 通过、工作区可见、快捷键未暂停且无转换 / 待确认导入时可用，不要求已选字幕。G / Enter（或个人覆盖键）统一校验并进入下一条，逆序等非法区间由原校验处理，不自动交换边界。点击定时不定位视频、不移动视窗，也不重置缩放。浏览器验证见 `browser-tests/boundary-click-checks.mjs`。

本地工作区初始化或导入无行 ASS 时，EditorWorkbench 经 `../cue-defaults.ts` 补一条 0–2 秒空文本字幕并选中；加载视频后直接显示两条分开的入 / 出点线，使用文档第一种样式。已有行不被重新初始化，未修改的默认行不触发刷新 / 导入确认；编辑后的草稿和已导入字幕继续保护。删除所有行后的 0 / 0 草稿仍可显示、定时，不立即补回被删行。非空文档没有选中行时仅显示已存在的字幕区间。无效时间字符串仍暂不绘制活动边界，原输入保留。

出点边界不拦截左键的 down / up 事件，交给 Spectrum 的入点点击或视窗平移处理，因此可以直接把上一条的出点用作下一条入点。匹配按键的边界拖动用 pointerId / 视窗快照 / 抓取偏移管理捕获；结束或取消后释放。出点自己的 contextmenu 仅阻止菜单，避免右键拖动结束时由父级重设时间；方向键微调仍保持。两条边界临时重合 / 零长度时允许保留草稿，提交 / 创建时仍需入点早于出点。

连续打轴流程是：左击定入点 → 右击定出点 → G / Enter 提交并下一条。EditorWorkbench 调用 `../commit-timing.ts` 写回当前行；存在下一行时只选择它，保留其时间、样式与文本；位于末尾时新增并选中空行，起点沿用刚提交行的出点、默认时长 2 秒、样式继承，默认时长与初始化共用常量。“创建新行”和“循环试听 / 提交并下一条”按钮行均已移除，提交和试听快捷键保留。显示 / 导航共用 `../cue-order.ts`，不重排原始 ASS 数据；非法区间或新增行超出时间范围时整次拒绝，不改变选中行或丢弃草稿。下一条选择沿用已有选择跟随视窗逻辑，不移动视频播放位置。回归见 cue-defaults / commit-timing 与 `browser-tests/commit-timing-checks.mjs`。

- `viewport.ts`：秒坐标、0.5–60 秒视窗、以指针为锚的缩放、平移边界；`xAtTime` 是标尺、频谱和 DOM 覆盖线共用的时间到位置映射。
- `ruler.ts`：纯函数负责 Aegisub 3.2.2 八档刻度、整数毫秒 tick 索引、相对上一条实际显示标签的前缀省略、测量避让；仅计算可见视窗。
- `draw-ruler.ts`：在原 canvas 顶部 22px 内绘制黑底蓝字、6px / 4px 刻度与一物理像素底线；导出 AUDIO_RULER_HEIGHT，供绘制和点击区域分派共用，不拥有视窗或交互状态。
- `draw-audio.ts`：canvas 像素绘制，合并峰值桶；先绘制普通信号，再对其他字幕区间的联合裁剪区切换 inactive 色表，最后对当前时间草稿切换 active 色表。重叠区间不累计变亮，当前草稿优先；波形共用同一范围背景，峰值仍只绘制一次。不解码媒体、不修改状态。
- `AudioTimeline.tsx`：模式 / 视窗、pointer / wheel 生命周期，原 video 播放头和边界叠加。
- `AudioCueIntervals.tsx` / `cue-intervals.ts`：其他字幕的只读边界及底线，区域填色由 Canvas 的实际频谱色表承担，不再叠加蓝色透明遮罩。入点为橙色、出点为紫色的 2px 虚线（90% 不透明度），与活动边界共用局部 CSS 颜色变量。相邻区间共享时刻时，出点线在左侧、入点线在右侧，保留两种颜色。只生成可见区间，按 cues / 当前行 / 视窗缓存投影；intervalPosition / xAtTime 同时用于 Canvas 裁剪及 DOM 边界。只绘制真实可见的端点，截断边缘不冒充字幕边界；pointer-events:none，不拦截定时、拖动、定位或滚轮。当前行从只读边界中排除，保留橙 / 紫实线与入 / 出文字。直接读取现有 cues，因此导入、提交、修改、删除后同步更新。
- `BoundaryCaps.tsx`：当前行滑块与非当前行边界共用上下两个 9px 三角端帽，入点向右、出点向左，形状参考 Aegisub PaintFoot。端帽不扩大命中区，pointer-events:none；随竖线定位到频谱本体顶 / 底，不覆盖标尺，不在裁剪边缘伪造端点。
- `AudioBoundary.tsx`：有 pointer capture 的可访问边界滑块；拖动及方向键将时间吸附到 10ms，Shift 方向键为 100ms。仅更新 EditorWorkbench 的 changeTimeDraft；G / Enter 通过 commitAndAdvance 提交。逆序等草稿继续由原校验拒绝，未绕过字幕契约。
- `draw-spectrum.ts`：仅绘制 Worker 的时频能量；每个组件持有 SpectrumImageCache（WeakMap），每个 tile 按 normal / inactive / active 最多缓存三张当前目标高度的图像，随 tile 释放，不创建全局缓存；仅转换实际与裁剪范围相交的 tile。高度 / DPR 改变时各色表图像按需重建。
- `spectrum-pixels.ts`：纯函数将固定 0..255 能量映射到色表。normal 保留原黑 / 蓝 / 青 / 白色表；inactive / active 参考 Aegisub 3.2.2 Icy Blue 的 Inactive / Primary HSL 参数，让弱能量背景及语音能量都能显示状态差异，active 更亮。缩小按覆盖频带取最大值，放大插值能量，再转 RGBA。低频在底部，alpha 恒为 255；三种状态共用同一能量和采样算法，不改 dBFS / FFT，不用 CSS invert 或整图滤镜。
- `media/audio/use-audio-analysis.ts`：Worker 会话与陈旧结果隔离，视图仅接收当前窗口的分析 tiles。

播放头 RAF 只更新一条 DOM 线，波形仅在数据 / 视窗 / 尺寸变化时重绘。视窗在无视频元数据时不被跟随逻辑重置。字幕行选择经 revealInterval，仅在区间超出视窗时移动；已可见的下一行保留视窗与之前区间的上下文，输入时间草稿不会重置缩放或平移。已有 seekVideo / EditorWorkbench 的操作仍是播放和字幕状态入口。

红色播放头的可拖命中区为 12px，悬停光标为 ew-resize，没有新增悬浮提示。AudioTimeline 的同一个 pointer capture 生命周期通过 `TimelineDrag.kind` 区分视窗平移与播放头定位；按下时记录既有 AudioViewport 和抓取偏移，拖动通过 timeAtX → 原 onSeek → seekVideo 更新视频时间。拖动期间阻止视窗自动跟随 / 滚轮缩放平移，指针出界时限定到当前可见范围；不自动延伸视窗。定位保留视频原来的播放 / 暂停状态，不修改字幕草稿。

pointerup / pointercancel / lostpointercapture 均清理拖动状态，按 pointerId 隔离多指操作。播放头与字幕边界重叠时边界优先命中，保留原边界编辑。video.currentTime 在定位时可能取整到微秒；判断可见范围允许 1µs 容差，并把边缘显示位置约束到 0–100%，避免边缘舍入误触发平移或隐藏播放头。真实浏览器回归位于 `browser-tests/playhead-checks.mjs`，由 audio-timeline 脚本调用。

左 / 右键操作 stage 时显式 focus({preventScroll:true})，右键定出点不再保留此前输入框的焦点。边界滑块继续在匹配按键拖动时保留自身焦点，方向键微调不变；workspace 的快捷键过滤允许 role=slider 上的 Enter / Space 提交 / 试听，避免原生 button 元素的激活规则吞掉打轴动作。普通按钮的鼠标点击由 EditorWorkbench 将焦点交回 main；Tab 键操作按钮、文本输入和 IME 仍保留原行为。两组时间采集 / ±10ms 按钮已移除，时间输入框仍可编辑；真实键盘回归见 `browser-tests/shortcut-focus-checks.mjs`。

Ctrl / Cmd + Delete 或 Backspace 由工作区删除当前行，音频组件不自行修改字幕。输入框内保留原生按词 / 按行删除，IME、长按重复及待确认导入继续保护。删除后工作区选择相邻行或重置空文档草稿；背景区间从新 cues 更新。首条标记、历史区间的平移 / 缩放对齐、鼠标穿透和删除回归见 `browser-tests/commit-timing-checks.mjs`；投影与视窗规则见 cue-intervals / viewport 测试。

本目录 viewport 测试覆盖坐标不变量；完整页面交互见 `frontend/browser-tests/audio-timeline.mjs`。布局继续使用项目 CSS 变量和原音频占位的空间。

## Aegisub 标尺契约

参考 [3.2.2 AudioDisplayTimeline 的 ChangeZoom / Paint](https://sources.debian.org/src/aegisub/3.2.2%2Bdfsg-3/src/audio_display.cpp/)。保留现有频谱绘制与 0.5–60 秒缩放范围，只替换原重复全时间标签和纵向网格。按像素每秒选择绝对时间刻度；225px/s 对应 100ms 短刻度 / 1s 长刻度，500px/s 对应 10ms / 100ms，20px/s 对应 1s / 10s。标尺与频谱、播放头、字幕边界共用 `AudioViewport`，不引入滚动状态。

按任务要求，首个完整显示的标签始终包含小时（例如 `0:00:05`），而非源码中短音频可省略小时的行为；其后按已绘制标签省略重复小时 / 分钟。秒补两位，小数精度为 1 或 2 位。`measureText` 检查完整文字与 4px 间距；碰撞或右侧裁剪时只跳过文字，不跳过刻度，也不更新前缀上下文。极窄窗口允许没有能完整容纳的标签。

Canvas 采用 getBoundingClientRect 的小数 CSS 尺寸，与 DOM 覆盖线一致；backing store 按完整 DPR 取整后，用实际横纵比例映射回 CSS 坐标，避免 clientWidth 取整造成位置偏差。ResizeObserver 和 resolution 媒体查询分别触发尺寸 / 屏幕 DPR 改变后的重绘。纯函数回归见 `ruler.test.ts`；`browser-tests/ruler-checks.mjs` 由既有 audio-timeline 浏览器回归调用，验证真实画布文字、缩放、滚动、resize / DPR 和点击标尺定位。字体采用现有 11px 等宽字体，不保证与 Aegisub 平台原生字体逐像素一致。

空文件、读取中、分析中与错误状态只占音频区域。输入非法时间时暂不绘制边界，保留编辑器原文；切文件时不显示旧数据。窗口结束点包含视频结束时刻，避免暂停在片尾时反复触发跟随重绘。

## 深色频谱与波形

频谱显示线性 0..Nyquist（48kHz 音轨显示至 24kHz），上限 / 下限文字来自实际 SpectrumTile，不再硬编码 8kHz / 80Hz。固定 -80..0dBFS 色阶在区间外使弱能量接近黑色，强能量依次为蓝、青与白；区间内使用不同 HSL 色表，静音背景有意显示为紫色调，强信号偏青绿 / 浅色，当前行更亮。不做逐帧自动归一化或降噪，不掩盖真实谐波。波形使用同样的区间背景与浅蓝峰值，播放头为亮红，入出点为橙 / 紫；footer / 状态提示限定在 `.audio-timeline` 内使用深色，没有改变全站主题和布局。

计算与显示选择的证据、兼容范围见 [频谱调查](../../../../docs/experiments/spectrum-display.md)。数值测试为 `media/audio/spectrum.test.ts`；颜色、频率方向、窄频带保留与上下采样见 `spectrum-pixels.test.ts`。浏览器回归使用带静音的 1kHz / 3kHz / 12kHz 合成 MP4；图中横向线条是已知正弦信号，不代表真实语音观感验收。

区间状态色表、端帽的源码依据与回归见 [区间绘制记录](../../../../docs/experiments/interval-rendering.md)。这不是完整照搬 Aegisub 的 FFT / 能量模型：沿用原 normal 色表和分析尺度，仅引入其区间色表参数与 marker feet 形状。

项目集成：打开项目不初始化默认行或改写已保存快照；本地 File 通过项目 SHA-256 校验后发布给分析 Worker。归档/会话失效/未验证媒体时禁用边界草稿更新及提交、删除。项目保存仍只包含已提交字幕；模式切换和隐藏恢复不重建 video。交互回归在 `browser-tests/main-audio-integration.mjs`，登录使用隔离项目浏览器库，运行方式见仓库集成记录。
