# 独立选区音频试听验证

2026-10-29。实现边界见 [实施计划](../plans/precise-audio-audition.md)、[媒体音频契约](../../frontend/src/media/audio/README.md)；本次保留工作区已有滚动条、边界样式及暂停字幕渲染修改。

## 实现

普通工作区 Space / S 和 Q / W / E / D 复用原 `auditionRange` 和个人快捷键分派，改为独立 Web Audio 试听。开始时暂停视频并保留位置 / ASS；音频播放头与 footer 读取控制器，视频进度条 / 预览继续读取 video。普通播放 / 主动定位先取消试听，全屏 Space 保留普通播放 / 暂停。旧 `watchPlaybackRange` RAF 暂停路径已移除。

`LocalAudioSource` 保持原 MP4 + 原生 WebCodecs 能力、PTS、原声道及首尾样本裁剪。独立 Worker 不参与分析视窗取消链，每窗最多 2 秒 / 4 MiB；至多两个已排程窗加一个在途窗，含瞬时复制的逻辑 PCM 预算 16 MiB。分析缓存仍为 32 MiB，每源读取缓存仍为 8 MiB。长选区滚动预取，不新增总长度限制，不全片解码。读取 / 格式 / 无音轨 / 预取失败在原音频 footer 提示，不回退 video。

控制器在开始播放前设置每个 AudioBufferSourceNode 的 start/stop，buffer 只包含选区样本；50ms 开始前余量不缩短声音。结束时无需 JS 及时执行；定时器只补充分段与状态。完成 / 取消终止 Worker，普通视频操作停止旧节点，隐藏 / 换片 / 卸载 / pagehide 还关闭 AudioContext，pageshow 可重新使用。

快速定位后立即按 Space 的真实事件记录曾出现：键盘事件先开始 preparing，上一定位的 seeking 随后抵达。hook 只接受按键时已在进行、目标位置一致的那一个旧 seeking 事件；后续或新目标定位仍停止声音。原 `checkShortcutFocus` 通过这一连续操作验证隔离，无需用户等待定位。

## 单元与静态检查

执行于 frontend：

```sh
npm test -- --run
npm run typecheck
npm run build
```

- 29 个测试文件、281 项通过，包括试听控制器 / Worker reader、提取裁剪、原范围计算、个人快捷键 / 焦点 / IME、JASSUB 暂停时间基准。
- 覆盖部分首尾样本、非采样网格边界、声道反相、PTS 间隙、空 PCM、短选区、跨窗及 30 秒范围的逐窗推进；检查在途上界、高声道 / 高采样率的自适应窗口、取消与过期返回、预取不足（含 JS 越过整段出点才恢复）、Worker 通信 / 解码失败及 dispose。
- 类型检查、生产构建、`git diff --check` 通过。使用相对 import / export 路径扫描前端 110 个 TypeScript 模块（含类型导入），未发现循环；同时人工检查新增边界均由 workspace-ui 向 media 单向依赖，media 不访问字幕或网络客户端。

## 真实 Chrome

Chrome 147.0.7727.101；FFmpeg 自制 MP4，账号 / 配置使用 HTTP fixtures。ASS 专项继续调用既有无持久副作用转换接口，不写数据库。浏览器自动化驱动的代码与生成媒体均保留在本机；无媒体上传。

```sh
npm run test:audio-audition
npm run test:ass-preview
npm run test:fullscreen-playback
npm run test:video-progress
node browser-tests/vertical-zoom.mjs
```

新增试听专项检查：

- OfflineAudioContext 渲染真实 PCM：1ms（0.010–0.011s）、跨 2s 分段（1.99–2.03s）、15 秒（0.123–15.123s）。选区内为 ±0.125，外侧紧接 ±0.875 测试信号；两声道选区内最大误差 0，区间外最大输出 0。检查的是渲染样本，不是最终播放位置。
- 实时 AudioWorklet 捕获生产排程器的渲染输出：选区内幅度 0.125，出点后紧接幅度 0.8 的 3kHz 测试音。主线程忙等 80ms，其中一轮音频时钟从 0.245333s 到 0.328s，横跨已排程的 0.274s 出点。捕获 170 个渲染块；选区峰值 0.125，出点后峰值 0，没有测试音泄漏。PCM 输入刻意含未裁剪的测试音，额外检验排程器自身的边界裁剪。
- 独立 Worker 实际完成 15 秒 MP4/WebCodecs 流式试听，跨初始两窗持续预取；短选区完成保留音频 1870ms 出点。
- 重复触发重启起点，旧节点停止 / 断连；滚动及 Shift 缩放触发分析请求时试听继续。普通播放 / 定位取消声音，视频始终保持静止直到普通播放；视频进度条不被音频位置覆盖。
- 换片、无音轨、ALAC 不支持、可见性切换、pagehide/pageshow、卸载：状态和资源断言通过，旧节点无连接、试听 Worker 清空、对应 AudioContext 关闭。
- Space / S / Q / W / E / D、个人覆盖、输入焦点、IME、键盘原生按钮、边界滑块、定位后立即 Space、全屏 Space 的检查通过；字幕表、时间草稿保留。

原有专项回归：

- ASS：非帧对齐 1.23–1.87s，三轮试听保持 1.23s 视频 / 字幕画面；显式定位 1.87s 后多次像素采样无已结束字幕。保留此前暂停 / seeking 使用 video.currentTime 的修复；重叠、编辑、全屏、故障恢复及项目重载检查通过。预期的 422 和阻断 WASM 故障注入仍属于测试内容，正常页面 errors 为空。
- 普通视频进度条、原生键盘定位及全屏播放 / 暂停通过。
- vertical-zoom 专项通过，包含已有横向滚动条、缩放 / 波形 / 频谱、标尺 / DPR、暂停及播放中拖动播放头、片尾定位；未覆盖或撤销用户原改动。
- `audio-timeline.mjs` 整套账号集成驱动尝试运行，但缺少隔离数据库 `BROWSER_TEST_PASSWORD`，未完成；其焦点辅助测试已由新增试听专项在 fixtures 下实际执行，视图 / 标尺 / 播放头辅助测试已由 vertical-zoom 专项实际执行。不将未执行的账号集成套件记为通过。
- 生产包通过临时 Vite preview（5187）运行 `FULLSCREEN_PLAYBACK_URL=http://127.0.0.1:5187 npm run test:fullscreen-playback`，验证打包后的试听 Worker 和全屏 / 普通快捷键路径。

## 限制

- 仍仅支持原 MP4 / 浏览器原生可解码音轨；没有增加 MKV、ALAC 等解码能力。准备新会话有 Worker / 解码启动延迟，不共享视窗缓存。
- 长选区在极慢读取、解码或主线程长时间阻塞导致预取无法赶上时明确停止并报错；已排程部分仍不会包含选区外样本。没有保证任意长卡顿下连续无间隙输出。
- 输出测试观测浏览器渲染 PCM，不是扬声器 / 系统回环录音；设备缓冲、重采样与物理声学瞬态未单独审计。未实测 Safari / Firefox、真实长片持续工作、极端多声道设备或操作系统原生内存峰值。
- 本次未修改字幕数据模型、保存状态或后端接口，也未实现视频跟随音频推进。没有需要顺带实施的无关架构重构。
