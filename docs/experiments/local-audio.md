# 阶段 A：本地 MP4 音频分段提取

2026-10-23。结论：**Mediabunny + 本地 File + 原生 WebCodecs 的分段 PCM 路线在已测 MP4 上可行**。按用户最后的要求停在阶段 A，没有实现或接入波形 / 频谱，也没有改动后端、播放器、字幕编辑、快捷键或页面布局。

## 当前实现与决策

1. 已阅读 AGENTS、架构入口、LocalVideoPlayer、playback、EditorWorkbench、CueTable 及相关测试。File 与 Object URL 当前由 LocalVideoPlayer 私有拥有，成功载入即固定片源。EditorWorkbench 拥有毫秒时间和字幕选区，seekVideo / applyTimes 为既有操作入口。当前只有字幕表和音频占位区，没有音频缩放坐标系。自动保存与实时协作尚属规划，不是当前已实现功能。
2. 固定 Mediabunny **1.62.0**（MPL-2.0），以安装包的类型及源码核对 `Input`、`BlobSource`、`MP4`、`getPrimaryAudioTrack`、`getDecoderConfig`、`canDecode`、`AudioSampleSink.samples`、`AudioSample.copyTo/close`、`Input.dispose`、Source read 事件；测试依赖 Playwright **1.62.1**（Apache-2.0）。没有引入 FFT 或转码依赖。
3. 新增 `media/audio/local-audio.ts`，只负责打开与分段 PCM；单次窗口上限 10 秒 / 16 MiB，字节缓存配置 8 MiB，无自建 PCM 缓存。库自身有预取及有限预解码队列。模块不依赖工作区，不产生音频播放或上传，不生成 MP3。
4. 用开发专用 probe 同时将同一个 File 交给 video 与音频源，独立于正式 UI，以便先验证路线。未来 B 再增加显式 File 回调与视图，不为验证提前扩大工作区状态。
5. 保留解码样本时间戳和原声道，按帧裁剪区间；AAC 负 priming 只裁去负时间部分，不把整条音轨归零。新请求使旧请求抛 AbortError，并归还迭代器；换文件释放 Input、读取缓存与解码器。

参考：[读取媒体](https://mediabunny.dev/guide/reading-media)、[媒体 sinks](https://mediabunny.dev/guide/media-sinks)、[格式与原生解码能力](https://mediabunny.dev/guide/supported-formats-and-codecs)。实际实现以本次安装包 API 为准。

## 实际浏览器验证

macOS / arm64，系统 Google Chrome **147.0.7727.101**，Playwright 无头模式；页面沿用 Vite 的 CSP / 跨源隔离配置。全部媒体由脚本现场用本机 FFmpeg 生成，不检索私人片源，不提交媒体。机器结果不可直接外推其他硬件和浏览器。

样本：120 秒、160×90 / 10fps、H.264/yuv420p + AAC-LC、48kHz 双声道反相 1000Hz 音，文件 2,487,930 字节。分别测试 moov 在开头和末尾、音轨延迟 2.5 秒、无音轨、ALAC 不支持、损坏文件与模拟 NotReadableError。

原始测量：[local-audio-results.json](local-audio-results.json)。浏览器验证运行两轮，以下数值取最后一轮：

| 项目 | 结果 |
| --- | --- |
| 同一 File 播放与提取 | 成功；video.src 为 blob，提取时原视频继续从 35 秒播放，没有被切到提取的 80 秒 |
| 10 次随机 / 重复 2 秒提取 | 每次 96,000 帧 / 声道、768,000 字节 PCM，非零能量；起止时间误差不超过 1 个采样帧 |
| 区间耗时 | 10.38–45.06ms（包含遍历 PCM 统计峰值）；只做 10 次，不是稳定性 / 全片基准 |
| moov 开头 / 末尾 | 均可打开并在 100 秒附近提取，无需顺序解码到目标 |
| AAC priming 与偏移 | 普通片首包 -0.021333s；延迟片首包 2.478667s。0–1 秒无 PCM；2–4 秒 PCM 从 2.478667 到 4 秒，保留实际包 / 样本坐标，不归零。未做真实语音听辨或音视频口型对照 |
| 快速跳转 | 同时发起 15 个请求，前 14 个均 AbortError 且没有向消费者交付 PCM，最后一个完成；外部取消、取消后继续读、解码中 dispose 均通过 |
| 换片 | 解码后切换无音轨文件、错误后重选有效 MP4 通过，未出现旧结果覆盖 |
| 异常 | 无音轨→no-audio，ALAC→unsupported，损坏与模拟读取失败→unreadable；原视频控制与提取独立 |
| 网络 / 页面异常 | probe 内未观察到非 GET 请求，pageerror 为 0；源代码只有 BlobSource，没有上传或远程媒体源。没有做系统级抓包 |

## 大文件与内存：验证范围

脚本在同一媒体 mdat 与末尾 moov 之间放置 **5 GiB 稀疏 free box**，得到 5,371,197,050 字节的有效 MP4。原媒体 offsets 不变，moov 跳到超过 32 位位置。Chrome 通过本地 file input 选择它，打开 4.66ms，在 100–102 秒提取耗时 9.74ms；打开加提取累计物理读取 **2,684,538 字节**，最大单次读 2,097,152 字节，证明该案例没有把 5 GiB 文件整体读入 JS。

**这不是几 GB 的真实视频**：有效媒体仍只有 120 秒，不能验证数小时的索引大小、真实磁盘分布、长 GOP / 碎片 MP4、实际大媒体码率或播放流畅度。Mediabunny 可能预取整个小文件（本轮约 2.5MB），有界缓存并不意味着永不读完整个小文件。

同一稀疏文件做 30 次随机 5 秒提取，累计产生 57,600,000 字节 PCM，每块最多 8,192 字节，消费者同步丢弃。通过 CDP 强制 GC 后的 usedSize 为 8,012,744 → 8,011,252 字节，backingStorageSize 为 8,075,058 → 8,075,023 字节，未见该轮持续保留 PCM。**这些是 GC 后快照，不是峰值内存、进程 RSS 或解码器内存测量**。8 MiB 只约束源字节缓存，容器索引、原生解码缓冲和调用者保留的 PCM 不在此限额内。

## 自动检查与复现

```sh
cd frontend
npm ci
npm run typecheck
npm run test -- --run
npm run build
npm run dev -- --port 5176
# 另一个终端；需本机 ffmpeg 和系统 Google Chrome
npm run test:audio-browser
```

手动入口：`http://127.0.0.1:5176/experiments/audio-probe.html`。选择 MP4 后输入区间再提取；不需要 ASS 服务。`AUDIO_PROBE_URL` 可指定其他本机开发端口。脚本只生成临时合成文件，并打印统计 JSON；不会启动 Vite，也不会下载浏览器。probe 不是正式生产构建入口。

已执行 typecheck、完整前端单元测试（5 个文件、71 项，其中本次新增 22 项）与生产构建，均通过；实际浏览器脚本通过。单元测试包含裁剪 / 负时间 / 偏移、无效区间、PCM 预算、能力检测、打开取消、过期请求、错误及资源释放。没有改动或运行后端测试；既有前端快捷键 / 试听 / 尺寸约束回归均随完整测试运行。检查实际 TS/TSX 相对导入图无环，新音频模块没有反向依赖 UI 或字幕数据模块。

## 未验证与后续边界

- 没有用户真实片源，也没有真实多 GB / 多小时片源性能结果；尚未测试 Safari、Firefox、移动设备、其他编码容器、多音轨选择、所有异常时间基准 / edit list 或 fragmented MP4。
- 当前没有 Worker；这里只做短窗口解码和复制。波形 / FFT 阶段应将重计算移入 Worker，并按可见窗口安排有限缓存，不能由本次快照推断频谱性能。
- 阶段 B 的 File 接线、波形、缩放 / 平移 / 播放头与字幕边界，以及阶段 C 的频谱均未实施。现有打轴页音频区继续显示占位。
- 没有阻断本次技术路线的问题，也没有增加服务端处理或音频转换回退。严格停在阶段 A，后续实施需新的任务指令。
