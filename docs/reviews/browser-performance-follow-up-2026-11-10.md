# 浏览器性能后续检查（2026-11-10）

## 结论

根据 [交接文档](browser-performance-handoff-2026-11-10.md)、[架构入口](../architecture.md)、后续修复记录及当前工作树代码，本轮未发现新的已验证缺陷。下一步应优先补性能测量和少量浏览器边界测试，目前没有充分证据支持扩大性能重构。

交接文档中的“R4 尚未修复”是当时的历史状态。当前实现已在删除阅读锚点后，按上次提交的行顺序选择存活后继，无后继则选择最近前驱；保持行内偏移，并由行高限制。实现和已有证据见 [R4 修复记录](../experiments/browser-performance-window-fixes.md#r4删除阅读锚点时的相邻行交接2026-11-10)。本轮另用当前生产包运行完整窗口化浏览器回归，R1–R4 均通过。

本轮检查没有修改业务代码或测试。报告按用户后续要求新增，原交接文档和历史失败证据保留；未提交、重置或清理其他工作树改动。

## 检查范围与版本

- HEAD：`601ab28d491f5c654bbf61fbc2420e7e576006cb`。性能实现及相关修复仍包含未提交、未跟踪文件，不能仅用 HEAD 复现当前检查对象。
- 检查模块：`workspace-ui/CueTable`、`CueRow`、`use-cue-window`、`cue-window` 及对应测试；`media/audio/use-audio-analysis`、`audio.worker`；`workspace-ui/audio-timeline/AudioTimeline`；`ass-preview/preview-session` 及相关测试和模块契约。
- 功能浏览器验证使用本机 Chrome、隔离 HTTP 夹具和临时生产预览，不依赖业务数据库写入或媒体上传。
- 本轮未重跑完整性能基准、完整旧音频套件、真实媒体内存、远程网络或跨平台验收。功能通过不等同于性能验收完成。

报告归档时关键源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `frontend/src/workspace-ui/use-cue-window.ts` | `a51bd9c8c9ed83a208d209cd6146e2642f0a58138d88bb2655a99ecceeb9abb2` |
| `frontend/src/workspace-ui/cue-window.ts` | `0b30939067e7483cd58cee2f2c94f3490da0e0e1114ff62eaf8909db9669221b` |
| `frontend/browser-tests/cue-window-threshold-checks.mjs` | `978d8a9b5358c7e5eb13434cc55602d8f55813035a20c6a72453b55a04aefc0b` |

## 本轮实际验证

以下命令除 `git diff --check` 外均在 `frontend/` 执行：

| 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test -- --run` | 45 文件 / 402 项通过，含相对导入环及依赖边界检查 |
| `npm exec vite build -- --outDir /tmp/cuerelay-review-20261110-dist` | 生产构建通过；主 JS 约 770.09kB / gzip 230.27kB，保留既有超过 500kB chunk 提示 |
| `CUE_WINDOW_URL=http://127.0.0.1:5279 node browser-tests/cue-window.mjs` | 完整通过，进程退出码 0；含 R1–R4、连续多行/软换行、QC、隐藏恢复、列宽、焦点/Tab、跨窗口选择及历史重排 |
| `git diff --check` | 通过 |

生产预览命令：

```sh
npm exec vite preview -- --host 127.0.0.1 --outDir /tmp/cuerelay-review-20261110-dist --port 5279 --strictPort
```

首次启动预览因沙箱端口监听限制失败，获准重试后成功，不属于应用缺陷。测试结束后已停止本轮临时预览服务。

本轮生产包 R4 关键断言结果：

| 阶段 | 首个可见 ID | 行内偏移 | scrollTop |
| --- | --- | ---: | ---: |
| 单行删除前 | `new-99` | 20.5px | 5069 |
| 删除后，200 行 | `new-100` | 20px | 8633 |
| 撤销后，201 行 | `new-100` | 20.5px | 8720 |
| 重做后，200 行 | `new-100` | 20px | 8633 |
| 批量删除后，197 行 | `new-102` | 20px | 8546 |
| 批量删除撤销后，201 行 | `new-102` | 20.5px | 8894 |

验收比较阅读行和行内偏移，不要求不同布局下 scrollTop 相等。浏览器输出暂存于 `/tmp/cuerelay-review-20261110-window.log`；临时文件不是跨机器复验的前提，上表保留核心结果。

## 下一步优先级

### 1. 最高优先级：R3/R4 后的生产性能复测

当前 [use-cue-window.ts](../../frontend/src/workspace-ui/use-cue-window.ts) 的无依赖数组布局 effect 每次提交都会遍历已挂载行，读取 `getBoundingClientRect()` 测量行高；原生小列表随后还会通过 `readAnchor()` 再遍历 DOM 获取阅读锚点。相比只观察窗口化列表，这明确增加了工作量，但尚未证明会产生可感知的性能退化。

建议复用原 100/500/2000 行基准，增加 199/200/201 行，分别测原速和 4 倍 CPU 限速下的输入、搜索、播放、滚动及跨阈值删除/撤销。记录输入延迟代理、Long Tasks、布局耗时和阈值切换后的阅读位置；沿用多轮测量，避免把噪声当作回归。输入到两次 RAF 不是 INP，CPU 限速也不替代真实低端设备。

如果测量确认额外布局工作造成持续退化，再考虑减少无关提交中的测量，并保持正文/宽度变化、原生滚动和模式切换的正确性。当前不建议直接重写窗口化或调整阈值。

### 2. 补少量窗口化边界浏览器测试

现有 [阈值回归](../../frontend/browser-tests/cue-window-threshold-checks.mjs) 已覆盖跨阈值单行/批量删除、撤销/重做。建议补充：

- 删除阅读锚点后列表仍超过 200 行。
- 删除锚点及其后继后，无存活后继时回退最近前驱，验证实际滚动钳制后的合理位置。
- 存活后继比原锚点短，原行内偏移超出新行高度，验证偏移截断及相邻内容可见性。

[纯函数测试](../../frontend/src/workspace-ui/cue-window.test.ts) 已覆盖部分邻行选择与偏移规则；新增浏览器测试应验证 DOM 布局和滚动行为，避免重复纯函数断言。这些是覆盖缺口，不是已确认缺陷。

### 3. F3：先测真实网络下的最终预览延迟

[preview-session.ts](../../frontend/src/ass-preview/preview-session.ts) 保留 120ms debounce、在途转换取消、版本隔离和串行 Track 更新。已有测试覆盖过期响应、慢初始化、非法草稿恢复及释放。

下一步应在实际部署网络条件下测量“最后输入到正确字幕实际出现”、请求体积和服务端转换耗时，并区分输入频率、RTT 和带宽的影响。模拟网络可用于可重复对比，但不能替代真实网络数据。历史记录中的慢速输入仍产生多个完整转换请求，详见 [F3 原测量](../experiments/browser-performance.md#f3-预览补测与取舍)。

延长 debounce 可能减少请求，也会增加预览等待；取消客户端请求不能直接作为服务端未执行转换的证据。只有确认瓶颈后再选择调度方案，保留唯一 ASS 序列化器及过期/非法草稿保护。

### 4. F6：真实媒体与长生命周期内存验证

使用真实高规格、多声道高采样率素材，覆盖反复播放、定位、试听、隐藏恢复，以及允许换片的测试入口和卸载场景。观察浏览器相关进程、GPU/WASM/原生解码器的峰值和释放后趋势，并记录素材规格、操作轮次与观察时长。

现有分析 LRU、PCM 预算和 Worker terminate 计数不足以证明全进程无持续保留，也不能据此认定存在泄漏。目前不建议凭未测风险调整缓存预算或增加媒体 Worker。

## 可复验性与其他验收边界

- 建议将性能基准驱动和素材生成方法纳入仓库，提供明确运行入口；大型素材和原始输出可以留在外部。当前功能测试已在仓库，但性能驱动主要依赖本机外部目录，增加新环境复验成本。
- Safari/Firefox、Windows、真实低端设备与屏幕阅读器仍需按产品支持范围补测。ARIA 属性和 Chrome 键盘回归不能替代实际辅助技术验收。
- 当前模块所有权和依赖方向保持清晰，单元测试中的边界检查通过。本轮没有发现需要立即实施的额外架构重构；优先完成上述测量，再依据证据决定优化范围。
