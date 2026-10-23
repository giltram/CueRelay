# 频谱差异调查与深色显示

2026-10-23，任务范围仅为现有音频分析 / 显示；不提交或推送代码。输入依据为用户的两张截图；时间缩放、窗口高度与 Aegisub 配置不一致，截图不能用作逐像素或音频数值证据。

## 调查与执行计划

1. 核对 LocalAudioSource → AudioSegmentStore → analyzeSpectrum → SpectrumTile → drawSpectrum / drawAudio 的契约和现有基线测试。
2. 用可重复的静音、正弦、多频、振幅与时间门控信号验证：频率、功率 dB、声道、时间网格和低能量；区分显示参数与计算错误。
3. 保留提取、Hann STFT 和共享坐标。用明确的固定 dBFS 范围及黑 / 蓝 / 青 / 白 LUT 替换浅色映射，调整频率显示范围与垂直采样；仅修复有数值证据的归一化 / 渲染问题。
4. 音频区域内同步调整波形、边界、播放头、状态和 footer 的对比度；不改全站主题、布局与交互。
5. 更新纯函数与真实浏览器像素检查，运行前端测试 / 类型 / 构建 / 交互回归，记录数值、限制和源码依据。

## 修改前证据

- `local-audio.ts` 选择主音轨，通过实际 AudioDecoderConfig 解码，保留原声道、采样率和 presentation timestamp；`segment-store.ts` 按时间戳安放 PCM，并为 STFT 提供相邻段。现有时间偏移 / 裁剪、反相声道及分段与整段一致测试支持这些契约，目前无证据要求替换提取架构。
- `spectrum.ts`：48kHz 时 FFT=2048、hop=512、对称 Hann，约 42.67ms / 10.67ms；44.1kHz 时约 46.44ms / 11.61ms。逐声道 FFT 后平均功率，以 Hann coherent gain 校正，再使用 `10*log10(power)`；没有每帧归一化。这不是幅度 / 功率对数混淆。
- 旧显示为线性 80–8000Hz / 128 行、-90..-15dBFS 的固定 8-bit 范围。`draw-spectrum.ts` 的旧公式使零能量为 RGB(243,245,242)，最大能量为 RGB(16,46,38)，alpha=255，且正确翻转低频到底部。浅色反向亮度是旧设计，与本任务目标不符；不是 PCM 被反转。
- Aegisub 3.2.2 `audio_renderer_spectrum.cpp` 的 Render 使用线性 0..Nyquist 频率轴，缩小时每个显示行取覆盖频带最大值，放大时插值。FillBlock 使用 log10(缩放后的 FFT 幅度+1)，不同于此项目的 Hann / dBFS。其默认配置选择 Icy Blue。不能将二者参数差异当成 FFT 错误。
- 因为网页仅显示到 8kHz，相同语音谐波会占据更大的垂直空间；全频段显示则让高频无能量区留黑。谐波横纹可为正常语音结构；是否含真实底噪不能仅从截图断言。

源码依据：[Aegisub 3.2.2 频谱实现](https://raw.githubusercontent.com/Aegisub/Aegisub/v3.2.2/src/audio_renderer_spectrum.cpp)、[默认配置](https://raw.githubusercontent.com/Aegisub/Aegisub/v3.2.2/src/libresrc/default_config.json)。前者已下载至临时目录核读，不复制其实现。

## 结论与实现

| 分类 | 结论 / 修改 |
| --- | --- |
| 显示选择，非 FFT 错误 | 浅色反向亮度与 80–8000Hz 的裁剪是视觉差异的主要可证实因素。改为近黑底、强度递增的蓝 / 青 / 白 LUT，以及线性 0..Nyquist（48kHz 为 24kHz）。不能仅用调色解释所有谐波分布差异。 |
| 显示参数，非逐帧归一化缺陷 | 原 -90..-15dBFS 会让 -15dBFS 以上统一饱和。改为固定 -80..0dBFS，保留正常幅度范围的亮度差异，低于显示底噪阈值归零；不做按帧 / 按片自动增益，不滤除真实谐波。 |
| 已复现的渲染缺陷 | 原 `imageSmoothingEnabled=false` 直接缩小纵向图像可丢掉窄频带。Chrome 独立复现：依次在 128 行中点亮一个白色行，再缩至 17 行，111 个源行完全丢失。新 `spectrumPixels` 在缩小前按覆盖频带取最大值；128 个位置的窄带保留测试均通过。放大时插值能量，再映射颜色。 |
| 全频段端点处理 | 引入 DC / Nyquist 显示后，端点按单边谱正确使用 1 倍功率系数，普通 bin 使用 4 倍；最后一行包含 Nyquist。端点与同幅度 bin-centered 正弦校验一致；这不是旧截图差异的已证实根因。 |
| 保留的数值契约 | PCM 提取、绝对 presentation timestamp、逐声道功率平均、Hann、FFT size / hop、全局时间网格、32MiB LRU 均保持。48kHz 仍为 2048 / 512；不引入新的解码 / FFT 方案。 |

频率数据行从 128 增至 min(512, FFT/2)，避免全频段后过早丢弃频率分辨率；最终显示按 Canvas 物理高度汇聚 / 插值。`draw-spectrum.ts` 仍持有每组件 WeakMap，每个可见 tile 只缓存一个目标高度的图像，resize / DPR 改变时重建。`spectrum-pixels.ts` 仅依赖底层 SpectrumTile 类型；分析模块不引用 UI，没有新增循环或反向依赖。

波形改为同色黑底与浅蓝峰值，播放头亮红、入点橙、出点紫；状态与 footer 也只在音频容器内适配。未修改全站样式、布局、按钮、快捷键、字幕提交、后端或数据库。

## 验证结果

- 修改前基线：108 项 / 9 文件单元测试通过；没有将正常参数差异误记为已有计算测试失败。
- 修改后：`npm run test -- --run` 的 118 项 / 10 文件全部通过；`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 新增数值覆盖：8k / 44.1k / 48k 采样率下的 bin-centered 正弦，从峰值振幅 0.5 至 0.00005 验证固定 dBFS，与理论 `20log10(amplitude)` 换算误差至多 1 个能量码；静音、反相声道、1kHz / 多频 / 12kHz、分段与整段一致、时间门控边界、Nyquist 端点均通过。
- 新增像素覆盖：黑到白亮度单调、蓝 / 青节点、alpha=255、低频在底部、静音不被相邻时间列污染、缩小保留窄带、放大插值，且不修改原 SpectrumTile。
- 实际执行 `npm run test:audio-timeline`：Chrome 147.0.7727.101 解码 FFmpeg 生成的 H.264 / AAC 48kHz 反相双声道视频，1k / 3k / 12kHz 按 2 秒响 / 2 秒静音。三频像素分别为 RGB(55,204,232)、(1,173,223)、(10,134,210)；静音和无信号的 20kHz 区域均为 RGB(8,8,12)，alpha=255。初始仍仅解码 6 段，Worker 缓存 5,284,864 字节。
- 既有音频模式切换 / PCM 复用、缩放锚点、滚轮 / 拖动平移、点击 seek、播放 / 暂停、边界键盘 / 拖动 / G 提交、中文编辑与 ASS 导出通过。标尺、DPR 3 / 1.25 / 1 和 800×900 resize 回归通过；30 次视窗变更最大心跳间隔约 41ms，未观察到 longtask；pageerror / 媒体 POST 为零。
- 已查看浏览器输出的 `spectrum-stage.png` / `waveform-stage.png`：黑色高频区、已知正弦的蓝青水平窄带、清晰静音边界和浅蓝波形正常。截图是合成信号，水平线条为预期；不是用户片源的人声验收。

## 剩余差异与限制

没有用户截图所用的原视频，无法确认每条横纹是否属于原片谐波 / 底噪，也不能确认 Aegisub 实际选择的音轨与增益配置。多音轨选择、其他浏览器及真实长片仍沿用既有限制。本次不通过降噪或时间平滑抹掉谱线。

此实现保留 Hann 与明确的峰值 dBFS 标度，没有复制 Aegisub 的非线性幅度压缩、用户可调垂直增益或全部选区配色；因此不会逐像素一致。全频段显示必然让语音主要集中于下部，这是坐标含义变化，不是丢失高频信号；12kHz 用例已验证 8kHz 以上信号可显示。
