# 浏览器验证

现有功能套件入口见 `package.json` 的 `test:*`，要求已安装 Chrome、FFmpeg、Node 和仓库 `.venv`。`ass-codec.mjs` 调用后端纯 codec 创建合法夹具，不访问数据库。脚本分别使用各自的 URL 环境变量，默认地址请查看对应文件。

## ASS 独立引擎兼容性

`npm run test:ass-compatibility` 在 Node 中直接加载已安装 JASSUB WASM 与仓库 Noto Sans SC 字体，不需要 Chrome、FFmpeg、HTTP 服务或数据库。仅将引擎的文件传输适配为本地 WASM 字节，不替换解析/渲染。检查 F1–F4 及复核 R1–R3 的真实解释差异、受支持 ASCII 数字/语法空白、完整语料的事件/样式/顺序及字形几何与位图哈希往返；每条有效 Cue 还将模型 style_id 解析出的名称/字号/字体与实际引擎引用直接比较。受影响的 Default/Emphasis 分别在 2s/3.6s 渲染，避免只在未受影响时刻比较。明确区分 libass 的文件行尾空白处理与 DTO 原文保留。它不是完整浏览器预览验收，浏览器生命周期/播放/Canvas 路径仍由 `test:ass-preview` 覆盖。

## 窗口化回归

```sh
CUE_WINDOW_URL=http://127.0.0.1:5280 npm run test:cue-window
```

`cue-window.mjs` 组合连续多行/软换行、阈值交接、删除锚点及原完整列表行为。`cue-window-deletion-checks.mjs` 覆盖删除后仍超过 200 行、短后继偏移截断、无后继时前驱回退及滚动钳制。测试使用隔离身份和字幕 HTTP 夹具，不需业务数据库或媒体文件。

## 生产性能测量

先按根目录 README 启动本机 Django（默认 8000）。测量只调用无状态 ASS 接口；身份/个人设置为隔离夹具，无需登录或写入业务数据库。在 `frontend/` 构建并开启预览：

```sh
npm run build
npm exec vite preview -- --host 127.0.0.1 --port 5280 --strictPort
```

另一个终端运行：

```sh
PERF_URL=http://127.0.0.1:5280 PERF_OUTPUT=/tmp/cuerelay-performance.json npm run test:browser-performance
```

默认覆盖 100/199/200/201/500/2000 行、1×/4× CPU、每项三轮。每轮输入 24 字（50ms 间隔）、搜索四字（80ms 间隔）、播放五秒、20 次往返滚动。201 行另测三次删除→200→原生滚动→撤销及阅读位置。可用 `PERF_COUNTS=201,2000 PERF_RATES=1,4 PERF_ROUNDS=3` 缩小范围。

`performance-fixtures.mjs` 是字幕与素材生成入口：固定混合行高文本、30 秒黑色视频、双声道 48kHz AAC，FFmpeg 命令随代码保存。媒体和结果写入新的系统临时目录，不依赖历史机器上的夹具；JSON 路径会打印出来。输出目录需已存在。要求真实本机序列化/JASSUB/WASM ready，服务失败不能算有效样本。

输出包含原始逐轮输入统计、Long Tasks、CDP `LayoutDuration`/`LayoutCount`/`ScriptDuration` 差值、字幕行几何读取次数与耗时。两次 RAF 是输入延迟代理，**不是 INP**；CDP 布局耗时为阶段总量，几何读取耗时是带插桩的同步调用总量，两者不能相加。100ms 末尾等待用于交付 RAF/Observer，各场景一致。限速不代表真实低端设备；本驱动不测远程网络预览。fixture 与旧外部性能脚本不同，历史数值不应直接作严格 A/B 对比。比较实现应固定此驱动、构建模式、硬件和浏览器，多轮交替测量。

## 真实媒体与进程内存

```sh
MEDIA_FILE='/absolute/path/video.mp4' MEDIA_ASS='/absolute/path/subtitles.ass' \
  MEDIA_OUTPUT=/tmp/cuerelay-media.json npm run test:media-memory
```

使用相同的生产预览/Django。字幕通过唯一后端 codec 读取，原始媒体和字幕只读。默认八轮，每轮重新选片、远距离定位、播放、字幕选区试听、隐藏恢复、关闭预览并离开页面；每轮卸载后等待五秒，最终关闭 context 后再观察 30 秒。`MEDIA_CYCLES` 和 `MEDIA_RELEASE_SECONDS` 可延长观察。

另启动 Vite 开发服务后，可指定 `MEDIA_DEV_URL=http://127.0.0.1:5173`，增加既有 `experiments/audio-lifecycle.html` 的同文件重新选择、区间变化和 React 卸载。生产固定选片流程不因测试而放宽；开发探针结果单独记录。

每秒通过 CDP 获取本次 Chrome 的进程 ID，再由 `ps` 获取 RSS，按 browser/renderer/GPU 等进程类型汇总。结果只含规格/计数，不含媒体、完整字幕或文件名。当前 RSS 采样依赖 macOS/Linux 的 `ps`，不能在 Windows 原样使用。RSS 总和可能重复计算共享页面，不是独占物理内存、GPU 显存或精确 WASM 分配；一秒采样也可能错过峰值。Worker terminate / AudioContext close 计数表示调用次数（JSON 的 terminated / closed），不是原生内存释放证明；预算检查和有限观察中的平台内存趋势也不能证明无泄漏。真实素材规格、轮次和总时长必须一起报告；普通双声道素材不能代表高规格多声道验收。
