# 本地音频提取（阶段 A）

`local-audio.ts` 是 `media` 下的独立叶子模块，仅依赖 Mediabunny；不依赖 React、工作区、字幕 DTO、后端或播放状态。当前尚未接入正式页面。

## 公共契约

- `LocalAudioSource.open(file: Blob, signal?)`：传入已经选择的视频 File。只启用 MP4 容器，选择主音轨，用实际 `AudioDecoderConfig` 检查原生 WebCodecs 和 `track.canDecode()`。不注册额外解码器。
- `metadata`：编码、声道数、采样率、首包时间及元数据中的结束时间（可为 null）。单位均为秒；`endTimestamp` 不是减去音轨起点后的长度。
- `readRange(start, end, consume, signal?)`：流式返回 `[start, end)` 内、保留原声道的 f32 PCM，回调必须同步消费。保留 sample 的 presentation timestamp；不减去首包时间，不拼掉间隙，不伪造静音。负时间的 AAC priming 会在复制时截去，部分首尾帧按采样率裁剪。空区间可返回 0 chunks。
- 每次提取至多 10 秒、16 MiB 输出 PCM。后续宽视野应分段调度与降采样，不能直接提高限制后累积全片 PCM。
- 新请求取消旧迭代器；外部 AbortSignal 仅控制本次 open / read 操作。打开成功后由调用方拥有会话，必须在换片 / 卸载时 `dispose()`。取消抛 `AbortError`；其他错误有 `AudioExtractionError.code`。
- `diagnostics`：累计物理读取字节数、最大单次读取和配置的缓存上限。含库预取，不等同于驻留内存。

## 资源与边界

`BlobSource` 的字节缓存配置为 8 MiB。解码使用 `AudioSampleSink.samples(start,end)` 的内建有限预解码队列，逐块 `copyTo` 后在 finally 中关闭 sample；退出 / 取消时调用 iterator.return，销毁会话时 Input.dispose。模块不保留 PCM，调用方不能无限保留 chunks。库仍会解析容器索引，索引内存和解码器原生内存不属于 8 MiB 字节缓存限额。

不调用整个 File.arrayBuffer、decodeAudioData、AudioContext 或第二套播放器，不发起媒体网络请求。解码不支持与读取错误必须由未来 UI 单独显示，不能清除视频或字幕。阶段 A 的验证页与现有工作区相互独立。

## 验证入口

- 同目录 `local-audio.test.ts`：裁剪、时间偏移、内存预算、取消与错误 / 生命周期单元测试。
- `frontend/experiments/audio-probe.html`：开发服务器专用手动探针，同一 File 同时交给 video 和提取模块。显示 PCM / 读取统计，不输出 PCM 音频。
- `frontend/browser-tests/local-audio.mjs`：FFmpeg 自制样本 + Playwright / Chrome 实际浏览器验证，包括 5 GiB 稀疏容器寻址；详见 [实验记录](../../../../docs/experiments/local-audio.md)。

后续阶段 B 应让 LocalVideoPlayer 通过显式回调暴露同一个已选 File，音频任务由工作区编排。UI 仍使用现有视频时间（毫秒），仅在提取边界转成秒。选区仍由 EditorWorkbench 的时间草稿和 applyTimes 管理。尚未实现波形降采样、FFT、Worker 或 PCM / 分析缓存。
