# 本地音频提取与分析

`local-audio.ts` 是只依赖 Mediabunny 的提取叶子模块；`audio.worker.ts` 组合提取 / 分析 / 缓存；`use-audio-analysis.ts` 是 React 与 Worker 之间的适配层。媒体模块不依赖工作区、字幕 DTO 或后端。视图与坐标属于 `workspace-ui/audio-timeline`。

## 公共契约

- `LocalAudioSource.open(file: Blob, signal?)`：传入已经选择的视频 File。只启用 MP4 容器，选择主音轨，用实际 `AudioDecoderConfig` 检查原生 WebCodecs 和 `track.canDecode()`。不注册额外解码器。
- `metadata`：编码、声道数、采样率、首包时间及元数据中的结束时间（可为 null）。单位均为秒；`endTimestamp` 不是减去音轨起点后的长度。
- `readRange(start, end, consume, signal?)`：流式返回 `[start, end)` 内、保留原声道的 f32 PCM，回调必须同步消费。保留 sample 的 presentation timestamp；不减去首包时间，不拼掉间隙，不伪造静音。负时间的 AAC priming 会在复制时截去，部分首尾帧按采样率裁剪。空区间可返回 0 chunks。
- 每次提取至多 10 秒、16 MiB 输出 PCM。后续宽视野应分段调度与降采样，不能直接提高限制后累积全片 PCM。
- 新请求取消旧迭代器；外部 AbortSignal 仅控制本次 open / read 操作。打开成功后由调用方拥有会话，必须在换片 / 卸载时 `dispose()`。取消抛 `AbortError`；其他错误有 `AudioExtractionError.code`。
- `diagnostics`：累计物理读取字节数、最大单次读取和配置的缓存上限。含库预取，不等同于驻留内存。

## 资源与边界

`BlobSource` 的字节缓存配置为 8 MiB。解码使用 `AudioSampleSink.samples(start,end)` 的内建有限预解码队列，逐块 `copyTo` 后在 finally 中关闭 sample；退出 / 取消时调用 iterator.return，销毁会话时 Input.dispose。模块不保留 PCM，调用方不能无限保留 chunks。库仍会解析容器索引，索引内存和解码器原生内存不属于 8 MiB 字节缓存限额。

不调用整个 File.arrayBuffer、decodeAudioData、AudioContext 或第二套播放器，不发起媒体网络请求。解码不支持与读取错误由音频区域单独显示，不能清除视频或字幕。阶段 A 的验证页与现有工作区相互独立。

## 验证入口

- 同目录 `local-audio.test.ts`：裁剪、时间偏移、内存预算、取消与错误 / 生命周期单元测试。
- `frontend/experiments/audio-probe.html`：开发服务器专用手动探针，同一 File 同时交给 video 和提取模块。显示 PCM / 读取统计，不输出 PCM 音频。
- `frontend/browser-tests/local-audio.mjs`：FFmpeg 自制样本 + Playwright / Chrome 实际浏览器验证，包括 5 GiB 稀疏容器寻址；详见 [实验记录](../../../../docs/experiments/local-audio.md)。

## Worker 与视图接线

LocalVideoPlayer 的 onFile 发布同一已选 File；EditorWorkbench 将 File、video、毫秒播放时间和选中字幕草稿传给 AudioTimeline。坐标和分析以秒为单位，仅在字幕 / 播放接口边界转换。文件不进入字幕 DTO 或 React 文档数据。

Worker 每次只处理最新视窗，以 2 秒段读取 PCM，用 4096 个 min/max 桶保留约 0.5ms 的瞬态；渲染时按像素合并桶。反相声道不会因下混而消失。单个 ByteCache 以 PCM + 分析 typed arrays 的实际 byteLength 计费，上限 32 MiB；视图只保留当前窗口相交的分析 tiles（视窗最多 60 秒），不接收 PCM。没有多级缓存或全片扫描。

每个 File 单独拥有 Worker；替换 / 卸载直接 terminate。视窗请求带递增 id，Worker 取消旧 readRange，UI 忽略旧 id；缓存命中循环也让出事件队列，避免旧视窗阻挡新请求。重计算和解码不在主线程。仅 video 播放，播放头读取 video.currentTime；手动平移暂时停止跟随，点击定位 / seeked 或「当前」恢复。

## 频谱

`spectrum.ts` 使用 fft.js 4.0.4（MIT，零运行时依赖），不用大型可视化框架。Hann STFT 的 FFT 长度按采样率选择最接近 43ms 的 2 次幂（512–8192），hop 为 FFT/4；48kHz 时为 2048 / 512。使用绝对时间 hop 网格和相邻 PCM，避免 2 秒分段边缘重新起窗。每声道单独 FFT 后平均功率，避免反相下混抵消。频率线性映射 0Hz–Nyquist，行数为 min(512, FFT/2)，低频行在前；每行聚合覆盖 FFT bins 的峰值，并包含 DC / Nyquist 端点。

单边峰值幅度功率以 Hann coherent gain 校正：普通 bin 用 4|X|²/sum(window)²，DC / Nyquist 用 |X|²/sum(window)²；声道间取平均，再做 10log10。固定 -80..0dBFS 映射至 0..255，阈值以下为零，不按帧或文件增益归一化。该值是打轴显示的峰值幅度标度，不是功率谱密度、RMS 或校准声学测量。颜色与目标显示高度的重采样属于 UI 模块，不进入 Worker。与 Aegisub 的幅度压缩不同，保留 Hann 的泄漏控制；调查依据与验证见 [频谱显示记录](../../../../docs/experiments/spectrum-display.md)。

两种模式共用 AudioTile 和同一个 PCM LRU，频谱仅在请求时计算；首尾窗最多多读相邻 2 秒段。谱图的 typed array 也计入同一 32 MiB 预算。FFT 每 16 列让出 Worker 事件队列并检查取消。UI 模式切换不重置坐标或播放器，ready 状态绑定 mode + start + end，避免新视窗暂时显示旧完成状态。

最终集成回归：`test:audio-timeline` 验证正式页面与生产包；`test:audio-lifecycle` 用开发专用 hook 探针验证快速换片 / 卸载，另在正式页面验证无音轨不阻断视频与字幕。探针允许换片仅用于测试，不改变生产页面原有的成功选片固定规则。资源验证计数指 terminate 调用，不等同于操作系统级原生内存审计。

AudioDisplayMode 仅是分析请求/输出的类型契约；个人偏好的保存和读取属于 accounts/account-ui/App。media 不访问账号或浏览器 Storage，受控 mode 改变时沿用同一个 File/Worker/PCM 缓存。
