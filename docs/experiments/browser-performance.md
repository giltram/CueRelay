# 浏览器性能优化验证（2026-11-07）

后续 [2026-11-07 检查](../reviews/browser-performance-2026-11-07.md) 复现窗口化的连续多行定位与隐藏/调宽跳位；2026-11-08 已针对 R1/R2 修复，并补充原先缺失的中段连续多行/软换行回归及生产性能复核，见 [修复记录](browser-performance-window-fixes.md)。本文件下列数据保留为首轮优化时的实际结果。

依据第一阶段 `cuerelay-performance/report.md`，本次完成 F1、F2、F4、F5；F3 补测后保留原调度，F6 保留真实媒体/全进程内存验证边界。执行步骤见 [计划](../plans/browser-performance.md)，契约见 [工作区](../../frontend/src/workspace-ui/README.md#字幕表渲染与滚动)、[音频](../../frontend/src/media/audio/README.md)。没有新增运行时依赖、保存协议或前端 ASS 序列化器。

## 基线与方法

任务开始 HEAD `601ab28d491f5c654bbf61fbc2420e7e576006cb`，工作树干净。原报告 manifest 的 166 个源码 SHA-256 与此 HEAD **全部一致**；原报告记录的较早 HEAD 加未提交改动已包含于本任务基线。

同一 Apple M3 Pro / 18GiB、Node 26.4.0、Chrome 147.0.7727.101，1440×900 / DPR 1。沿用原预生成 100/500/2000 行 JSON、30 秒短片与真实 7200 秒 / 85.9MiB 循环 MP4、真实本机 ASS export/JASSUB。账号/项目由隔离 HTTP 夹具提供，无业务数据库写入或媒体上传。

先只构建 F1，运行原 validation（每规模、原速/4 倍 CPU 限速、各三轮输入和查找）与原 profiling；确认 F1 收益及搜索残余长任务后再实施窗口渲染。最终构建重新运行 validation 与 extra。所有生产结果与 profiling 分开；输入指标是 input→两次 RAF 延迟代理，不是 INP。下表是各轮统计的三轮中位数；搜索每轮只有 4 字，报告最大延迟。

## 实测结果

| 2000 行指标 | 原基线 | 仅 F1 | 最终实现 |
| --- | ---: | ---: | ---: |
| 输入 24 字的 CPS 字素统计次数 | 48,000 | 24 | 24 |
| 原速输入 p95 | 24.2ms | 12.7ms | 14.8ms |
| 4 倍限速输入 p95 | 138.3ms | 52.6ms | 17.1ms |
| 原速查找每轮最大输入延迟 | 83.4ms | 82.1ms | 12.6ms |
| 原速查找三轮 Long Tasks 数 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 4 倍限速查找每轮最大输入延迟 | 370.9ms | 342.2ms | 14.2ms |

最终 100/500/2000 行的原速输入 p95 分别 14.9/14.3/14.8ms，4 倍限速分别 13.5/13.6/17.1ms，输入和查找均没有观测 Long Task。小规模差异未同时超过原报告的 10% 与 5ms 回归门槛。F1 与最终原速 p95 差异小于 5ms，不作性能退化结论。CPU 限速不代表真实低端设备。

相同 React profiling 下，F1 的 2000 行、5 秒播放中 CueTable 累计 render 从 117.4ms 降至 9.4ms（约 92%），CueSearchText 执行从 38,000 次降至 2 次；24 字输入的文本组件从 48,000 次降至 24 次。这里是 render 阶段，不能称为完整 commit/layout 耗时。最终 2000 行场景的一个稳定观测点只挂载 19 行、全页 314 个 DOM 元素（基线初始 18,112）；视窗/字体/换行变化时数量会改变，完整 2000 行数据仍在原文档内。

| 原 extra 脚本相同操作 | 原基线 | 最终实现 |
| --- | ---: | ---: |
| 20 次微小平移新建显示 Canvas | 228 | 0 |
| 同组平移 React commits | 81 | 60 |
| 同组平移 decodedSegments | 14，保持不变 | 14，保持不变 |
| 暂停约 2 秒 RAF / 音频 DOM mutations | 260 / 522 | 0 / 0 |
| 同标签页隐藏工作区约 2 秒 RAF | 251 | 0 |
| 60 秒视窗分析缓存 | 32,892,928 字节 | 32,892,928 字节 |

平移整段驱动时长约 298→115ms，包含自动化调度，只作辅助读数。Canvas 分配减少确认，不据此宣称已量化 GC、耗电或所有设备的体验收益。两小时视频的分段分析、远距离 seek、60 秒渐进分析都没有主线程 Long Task；首窗频谱整段驱动三轮约 316–332ms。12 次分析换片/卸载累计 Worker 创建/terminate 23/23，12 次 ASS 开关没有遗留预览 Canvas/顶层 Worker；主线程 GC 后堆仍有少量增长，与原基线相近，不推断无泄漏或存在泄漏。

## F3 预览补测与取舍

2000 行、180ms 间隔输入 16 字，三轮均为 16 个完整转换请求、最终 1 次 setTrack，payload 约 657,208–657,223 字节。暂停在首行可见的 1 秒处，输入前后截取 video-stage：三轮均看到包含最终 16 字的新字幕。最后 input 到截图确认新画面的**观测上界**为 295.5/281.5/286.2ms，含截图/自动化开销；不是精确像素呈现时刻。Track 往返约 4–7ms。

请求浪费依然存在，没有将 F3 标记为已优化。保留原 120ms debounce、取消/版本与非法编辑保护：仅串行转换并不能保证在这个按键间隔/RTT 下请求减半；延长 debounce 则直接增加末次预览迟滞。当前没有主线程瓶颈或真实远程 RTT 数据支持增加调度复杂度。后续若真实网络下预览超预算，应单独验证调度并保留乱序/无效输入恢复/关闭回归，不能把“减少请求”替代最终画面延迟目标。

## 功能验证

- `npm run typecheck`、`npm test -- --run`：45 文件 / 398 项通过，包含前端相对导入环/诊断叶子边界检查。
- `npm run build`：通过，主 JS 约 768.13kB / gzip 229.65kB，保留原有大块提示；本任务没有用包拆分扩大范围。
- 新增 `npm run test:cue-window`：2000 行变高文本、完整搜索/循环、跨窗口 Shift 多选与撤销、离屏焦点/Tab、菜单、QC reveal、列宽、窄屏及隐藏恢复。
- 新增 `npm run test:audio-reuse`：同分段不新建 Canvas/解码、暂停 2 秒零 RAF/DOM mutation、隐藏零持续 RAF、恢复后暂停 seek、waveform/spectrum 复用，全部断言通过。
- 原 `test:cue-table`、`test:subtitle-search`、`test:subtitle-line-menu`、`test:workspace-history`、`test:video-progress`、`test:subtitle-qc`、`test:boundary-snap`、`test:fullscreen-playback` 与 `node browser-tests/vertical-zoom.mjs` 通过。覆盖 IME、样式、重排/历史、剪贴板、5000 行 QC、10ms/吸附、播放头拖动、配色、DPR、滚动条和全屏。
- `test:audio-audition` 输出完整 PASS：实际 PCM 出点后峰值为 0、实时缩短/延长、主线程停顿、生命周期、工作区及焦点断言均通过。随后 Node 停在 browser.close，确认 Chrome 已退出后结束该测试 Node；不记为测试进程正常退出。
- `test:audio-timeline` 旧套件在进入测试时要求一次性账号数据库的 `BROWSER_TEST_PASSWORD`，本次未运行完整套件；改用隔离夹具的 audio-reuse、vertical-zoom 及上述媒体回归验证本次变更。extra 的音频开发探针实际完成 12 轮 hook 释放检查，不等同于完整旧 audio-lifecycle 套件通过。
- `git diff --check` 通过。未更改后端或跨模块依赖方向。

真实高规格片源、全进程峰值 RSS/GPU/WASM、Safari/Firefox/Windows/真实低端设备与屏幕阅读器实测仍未完成；当前结果限定 Chrome 合成素材。缓存预算不因这些未测场景改变。

## 材料与复现

本任务可视化目录的 `cuerelay-performance-optimization/` 保存 F1/最终 validation、F1 profiling、最终 extra、预览三轮 JSON/截图和脚本；原基线仍在此前任务的 `cuerelay-performance/`。原 reproduction.md 的 fixture、媒体、浏览器和脚本保持一致；仅将 PERF_URL 指向对应临时生产构建。功能脚本在仓库 `frontend/browser-tests/`，新增入口已登记 package.json。

本机使用 `/tmp/cuerelay-perf-20261107` 的既有固定素材；F1 生产构建 `/tmp/cuerelay-perf-f1-dist`，最终生产构建 `/tmp/cuerelay-perf-final-dist`。开发探针使用 5173，生产测量使用 5273/5275，profiling 使用 5274。测试驱动多次遇到 Chrome 退出后 Node 等待，完整 JSON 先保存，再仅清理本次测试进程，未结束原有浏览器或 5173/8000 服务。早期回归中使用了旧脚本默认端口或在生产地址动态导入源码，修正地址后完成上列实际检查；这些环境失败不作为应用缺陷或性能样本。
