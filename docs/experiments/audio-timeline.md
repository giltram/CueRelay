# 音频可视化 B–D 验证记录

2026-10-23，在独立 audio worktree 开发；阶段 A 基线及真实大文件限制见 [local-audio.md](local-audio.md)。所有浏览器媒体由 FFmpeg 自行合成，不使用私人片源。

## 阶段 B：波形

- 已接入同一个本地 File，解码、峰值分析与 32 MiB 分段缓存都位于 Worker；每段 2 秒，4096 个 min/max 桶，视窗最多 60 秒。没有整片 PCM 或第二播放器。
- 支持 0.5–60 秒缩放、指针锚定滚轮缩放、水平滚动 / 拖动平移、点击原视频定位、播放头跟随、字幕选中行与入出点显示。原有播放、文本编辑和快捷键不变。
- 实际执行 `typecheck`、79 项单元测试及生产 build，均通过；Worker 为单独本地构建资源。
- 真实 Chrome 147.0.7727.101 + Playwright：45 秒 H.264/AAC、48kHz 反相双声道，1000Hz 音按 2 秒响 / 2 秒静音。canvas 可读出波形和静音；初始 10 秒仅解码 5 段，缓存 4,003,840 字节。放大到已缓存区间不增加解码段数。
- 实测滚轮缩放、拖动平移、点击定位、播放 / 暂停 / 跳转、导入基础 ASS、选中行两条边界、原 G 提交、中文文本编辑和 ASS 下载，均通过。无 pageerror 或媒体 POST。
- 浏览器回归发现并修复：元数据返回前 RAF 将初始视窗缩至最小；原占位 h2 样式优先级导致工具栏按钮被遮挡。

复现：在本 worktree 启动 ASS 服务和前端，运行 `cd frontend && npm run test:audio-timeline`。默认前端端口 5176，`AUDIO_TIMELINE_URL` 可覆盖。可用 `CUERELAY_API_TARGET=http://127.0.0.1:8016` 给 Vite 指定独立 ASS 服务；不改默认 8000。需本机 FFmpeg / 系统 Chrome。脚本生成临时文件和截图。

## 阶段 C：频谱

- 加入 fft.js 4.0.4（MIT、零运行时依赖）；已核对安装包 realTransform API，参考 [官方仓库](https://github.com/indutny/fft.js)。不采用另一个可视化框架。
- Worker 内 Hann STFT，约 43ms 窗 / 11ms hop，80Hz–8kHz（低采样率截至 Nyquist）128 行，颜色越深能量越强。两模式共用同一 PCM 段、时间坐标和播放头；跨段用绝对 hop 网格及邻段样本，保留时间偏移。
- 实际执行 86 项单元测试、typecheck、build 和完整 Chrome 页面脚本，全部通过。单元测试验证 500/1000/3000Hz 定位、静音、反相声道、8kHz 采样率、跨段与整段 STFT 一致、FFT 批间取消。
- 浏览器切换到 Spectrum 后视窗仍是 0–10 秒；解码段数从 5 到 6，仅多读边缘邻段。切回 Waveform、放大已缓存范围均不增加解码。频谱缓存 4,924,672 字节；1000Hz 的声音与静音像素具有明显深浅差别，已查看截图。
- 修复模式切换时短暂沿用旧 ready 状态的问题；首次新增依赖的 Vite 预构建会刷新开发页面，生产包不经过该流程。

## 阶段 D：整合与资源验证

- 边界拖动和可访问 slider 的方向键更新既有 `changeTimeDraft`，与采集 / 微调 / 时间输入共用草稿入口；10ms 吸附、Shift 100ms，仍需 G / 原应用按钮提交，原区间校验保留。禁止在忙碌或待确认导入时拖动。
- 主线程仅绘制：频谱像素结果用每个组件自己的 WeakMap 复用，旧 tile 不被缓存永久保留；播放头 RAF 更新一条线，不重画音频。修复暂停在视频结束点时可能不断触发视窗更新的问题。音频范围可聚焦后用方向键平移。
- 最终 **88 项 / 8 文件单元测试、typecheck、build、开发模式页面脚本、Worker 生命周期脚本、阶段 A 提取回归及生产预览页面脚本全部通过**。没有修改 Django 后端、数据库、字幕 DTO 或自动保存 / 协作逻辑；当前 audio 分支基线尚未实现自动保存与协作。
- 页面实际验证：入点由 1.20→方向键 1.21→Shift 1.31→拖动 1.50 秒，按 G 后字幕表显示 1.50；视频播放 / 暂停 / 跳转、两模式坐标与播放头、缩放平移、原快捷键、中文编辑及 ASS 下载继续通过。
- 快速操作：频谱分析中连续 30 次方向键视窗变更，完成后仍是最后请求的 7.40046–10.75206 秒，缓存约 8.15MB。开发模式主线程心跳最大间隔 65.04ms，生产模式 40.73ms；该测量区间没有观察到 >50ms longtask。不是系统级 FPS / 全片流畅度承诺。
- 生命周期探针（只在开发服务提供）允许绕过产品固定片源流程反复替换 File：14 次创建 / 14 次 terminate，重新挂载并清空后累计 15 / 15；旧文件的频谱没有覆盖最终无音轨状态。无音轨、ALAC 不支持后可恢复有效 MP4；正式页面无音轨视频仍可播放并创建字幕。原选片固定规则未改变。
- 生产 build 通过独立 5177 preview 实测，打包 Worker 与 FFT 在原 CSP 下正常；800×900 窄屏画布仍可用（740×82 CSS 像素）。pageerror 与非 ASS POST 均为 0。未做系统抓包。
- 5 GiB 稀疏 MP4 在生产页面自动生成前 10 秒波形，并切换频谱，初始只解码 5 段、缓存 4,003,840 字节。原提取测试重跑：100–102 秒窗口累计读取 2,750,074 字节；30 次随机 5 秒提取的 GC 后 usedSize 8,012,228→8,011,012 字节。仍不代表真实大媒体或原生解码器峰值内存结果。

最终机器可读证据见 [audio-timeline-results.json](audio-timeline-results.json)。截图由浏览器脚本保存到其输出的临时目录，不提交媒体。

```sh
# 在独立 worktree，服务分两个终端启动
cd backend
python manage.py runserver 127.0.0.1:8016 --noreload
cd ../frontend
CUERELAY_API_TARGET=http://127.0.0.1:8016 npm run dev -- --port 5176
# 另一个终端
npm run test:audio-timeline
npm run test:audio-lifecycle
npm run test:audio-browser
# 验证生产包（另一个终端启动 preview）
npm run build
CUERELAY_API_TARGET=http://127.0.0.1:8016 npm run preview -- --port 5177
AUDIO_TIMELINE_URL=http://127.0.0.1:5177/ npm run test:audio-timeline
```

`test:audio-browser` 打印合成样本临时目录；可将其中 sparse-5g.mp4 的路径通过 `AUDIO_LARGE_FIXTURE` 传给 test:audio-timeline，以复现生产页面的大文件 case。开发 Vite 新增依赖预构建会自动刷新页面，重跑前等待该过程结束。

## 已知限制

- 成功实测范围为本机 Chrome 147 的合成 H.264/AAC-LC MP4（48kHz 单 / 双声道，moov 前置 / 后置和音轨偏移）；尚无用户真实语音、数 GB / 多小时片源人工验收。其他浏览器、VFR / fragmented MP4、多音轨选择、其他编码容器未完成兼容性实测。
- 频谱是有限分辨率的打轴辅助，非校准分析仪；视窗范围 0.5–60 秒，可经 video 定位、字幕行定位、拖动或水平滚动查看其他范围，没有整片高精度预生成或持久化缓存。STFT 会有正常窗宽模糊。
- 32 MiB 只约束 Worker 缓存中保留的 PCM / 分析 typed arrays；加上源缓存 8 MiB、当前解码段、相邻 FFT 段、容器索引、原生解码器与当前 UI 图像，进程峰值高于 40 MiB。没有声称总内存硬限制或测过真实长片索引峰值。
- 原页面成功选片后仍固定片源，更换需刷新。换片取消用开发探针验证，生产 UI 没有新增换片入口。无新增复杂音频设置、服务器媒体处理或第二播放器。

B–D 功能已实现并验证，没有已知阻断；真实片源、跨浏览器与熟练字幕制作验收仍需后续实测。阶段 A 的多 GB 稀疏容器结果不代表真实长片性能。
