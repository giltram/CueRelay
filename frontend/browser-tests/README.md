# 浏览器验证

首轮接入真实 Django/PostgreSQL 的自动回归位于相邻 `regression/`，由 Django LiveServerTestCase 启动，不依赖本目录的 HTTP fixture 或外部服务。新克隆运行命令和 CI 范围见 [测试运行手册](../../docs/testing.md)。本目录旧脚本继续作为专项检查保留，未全部纳入 CI。

现有功能套件入口见 `package.json` 的 `test:*`，要求已安装 Chrome、FFmpeg、Node 和仓库 `.venv`。`ass-codec.mjs` 调用后端纯 codec 创建合法夹具，不访问数据库。脚本分别使用各自的 URL 环境变量，默认地址请查看对应文件。

## 工作区离开确认

启动 `npm run dev -- --port 5241 --strictPort` 后运行 `npm run test:workspace-navigation`（`WORKSPACE_NAVIGATION_URL` 可覆盖）。使用 Chromium、真实 Python ASS codec、合成视频和 IndexedDB，项目 HTTP 使用可控保存夹具，不写业务数据库。覆盖已保存/改回原值不提示、回首页后直接新建、离开前取消保留输入与节点、保存延迟/失败/重试、未应用时间及导出备份、明确放弃与历史重返、浏览器前进/后退、新标签页隔离、空白本地工作区/非法时间输入及英文交互。

## 字幕查找

同一 Vite 服务运行 `SUBTITLE_SEARCH_URL=http://127.0.0.1:5241 npm run test:subtitle-search`。使用 Chrome、纯 Python ASS codec、合成视频和隔离 HTTP 夹具，不写业务数据库。除查找、IME、媒体定位、编辑与撤销外，验证未保存本地工作区离开前提示、取消保留原查找节点及字幕/时间/媒体；在未验证片源和归档项目的干净快照上验证无提示隐藏、其他页面不拦截浏览器查找，以及历史返回恢复原查找节点、输入、当前命中和选中行。明确放弃会销毁实例，不用于验证保留状态。

## 会话上下文刷新

启动 `npm run dev -- --port 5173 --strictPort` 后运行 `npm run test:context-refresh`（`CONTEXT_REFRESH_URL` 可覆盖地址）。使用 Chromium、纯 Python codec、可控延迟 HTTP 和真实 IndexedDB，不写应用数据库。九组覆盖显式组织页的早开本地草稿范围与恢复（`local`）、持续重叠组织读取与旧权限隔离（`overlapping`）、退出后慢设置不阻塞列表（`leave`）、按资源清理错误（`retry`）、首页默认组织未知/首次失败/成功后相同入口恢复及无组织入口（`home`）、较新 503 不遮蔽成功撤权（`revocation`）、首次项目列表持续刷新与权限拒绝（`projects`）、账号切换后慢设置不阻塞明确放弃的草稿清理（`account`）、成功会话确认后迟到 401 静默且当前 401 正常登录保护（`authentication`）。可用括号内参数单独运行。

## 项目资源响应竞态

启动默认 5173 Vite 后运行 `npm run test:resource-response-races`（`RESOURCE_RACES_URL` 可覆盖）。真实 Chromium、8 秒 FFmpeg 合成视频、Python ASS codec、IndexedDB 与可控 HTTP，不写应用数据库。十六组可单独传 `workspace` / `authentication` / `completion` / `pagination` / `reload` / `reentry` / `archive` / `settled` / `recovery` / `isolation` / `denial` / `attempt` / `reselect` / `feedback` / `cancellation` / `search`：验证轮询/重返/显式重载的旧成功不能解除较新 403/404 只读、较新成功可恢复且编辑器/内存及持久草稿保留；迟到 401 静默且首次工作区/项目列表取消后自动重读；已恢复路由迟到取消不增加请求、不隐藏原编辑器/内存及持久草稿，并保留后续撤权状态；组织持续 503 时当前列表独立恢复/直接重试；旧总数不提前回退有效第二页，所有读取结束后采用有效总数校正，覆盖较新 503 先/后返回且保留其反馈；相同新 revision 的焦点成功不取消显式重载，成功替换后清理已放弃草稿；旧路由拒绝不隐藏新成功确认的编辑器，当前路由错误可由新检查恢复；双 503 保留路由错误及直接重试，隐藏期间旧轮询成功不能恢复新路由，原编辑节点/内存及 IndexedDB 草稿保留；用户切换状态/搜索/页码隔离旧错误与在途重试，同查询重试仍保留反馈；已恢复路由在后续撤权时保持只读编辑器，旧路由 404 不重现；路由重试建立新恢复门槛；重选任一当前状态标签回首页清除旧页错误；搜索在防抖期间改回已生效的空/非空查询时，保留第 2 页、错误、重试入口和请求数，真正改变查询仍回首页并隔离旧反馈；成功项目检查只清除项目反馈，保留组织错误和用户导出失败；保存和拆分确认归档后旧 active 不解除只读，真正较新恢复仍生效。脚本结束关闭浏览器并删除合成媒体临时目录。

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

## 术语表

`npm run test:glossary` 使用 GLOSSARY_URL（默认 `http://127.0.0.1:5227`），先启动相应 Vite；真实 Chrome、合成视频和纯 ASS codec，术语 HTTP 是有版本冲突/迟到响应的内存 fixture。覆盖组织设置维护/默认只读/项目fork快照/双向隔离/搜索/失败保留/冲突重载、管理员切回默认/归档、同侧栏断点、光标插入/选区/切行/历史、IME/快捷键及无字幕保存、播放器不重建、真实 App 项目/账号替换和撤权隔离。截图和结果写新临时目录。真实 PostgreSQL 并发/权限/迁移另由 projects.test_glossary / test_glossary_migration 验证。

真实组织维护→项目fork→修改旧词条/新增词条双向隔离→刷新持久化另有 regression/workspace.spec.mjs 的 organization glossary fork stays isolated；由 Django browser_tests.regression 自动播种隔离库和启动后端/Vite，不使用HTTP fixture。

## 中英文 / 伪本地化

`npm run dev -- --port 5240 --strictPort` 后运行 `node browser-tests/workspace-review-regressions.mjs`（可用 `WORKSPACE_REVIEW_URL` 指向其他 dev/production preview）。使用 Chromium、真实 Python ASS codec 和隔离 HTTP fixture，覆盖会话失效后普通下载包含未保存字幕、QC 警告继续/格式错误阻止，以及旧设置 GET 在语言 PATCH 成功前/后返回、GET 在写入期间启动和后续远端刷新。可传 `F1` / `F2` 单独运行；不需要数据库或真实媒体。

同服务运行 `node browser-tests/settings-response-races.mjs`（`SETTINGS_RACES_URL` 可覆盖）。七个场景覆盖登录后首次 GET 与语言保存交错、迟到音频/快捷键 PATCH 不覆盖新语言、迟到语言 PATCH 不覆盖新音频，以及成功语言选择与首次/远端 GET 的两种返回顺序、pending/failed 选择在加载完成后保留与成功重试后正常远端刷新。断言首次 ready、未修改的服务端字段、表单重挂载后的 App 设置和成功选择在两次后续刷新中不遮蔽服务器值；可传 `initial` / `personal` / `language` / `remote` / `lifecycle` 分组运行。HTTP 为可控提交后延迟响应的完整快照，不需要数据库；支持生产 preview。

`npm run dev -- --port 5238 --strictPort` 后运行 `I18N_URL=http://127.0.0.1:5238 npm run test:i18n`。复用 Chromium、真实 codec/JASSUB/音频 Worker 与隔离 HTTP fixture，语言矩阵从 shared/languages.json 派生。覆盖主要设置/项目/手册/编辑页面及弹窗、受限 QC 面板、行菜单、粘贴覆盖和草稿/选择/历史/本机句柄/媒体保留；OS picker 权限与剪贴板正文是本次 fixture 的受控输入。

layout-checks.mjs 只检查页面边界、指定 surface 和关键按钮的裁剪/实际命中可达性；允许表格/列表/顶栏拥有的内部滚动，不做所有 DOM 的全局溢出判死。截图固定字体、时间戳、动画和合成片源，输出临时 PNG/results.json；第一次输出不自动成为批准基线，人工只需检查新增/改动区域。既有脚本均明确 zh-CN，真实后端回归另有英文场景。命令及新增语言验收见 [国际化维护](../../docs/internationalization.md)。

构建并启动 5239 端口的生产预览后，运行 `I18N_PRODUCTION_URL=http://127.0.0.1:5239 npm run test:i18n-production` 和 `HANDBOOK_URL=http://127.0.0.1:5239 HANDBOOK_PRODUCTION=1 npm run test:handbook`，分别检查英文预编译手册/双语许可页和既有中文手册交互。

## 隔离专项入口（2026-11-22）

从仓库根目录运行 `.venv/bin/python scripts/run_isolated_regression.py --suite specialists --pg-bin /absolute/postgres/bin`，自动建立一次性PostgreSQL、真实后端和envFile:false Vite，串行复用video-restore、audio-timeline、audio-audition三脚本；显式提供一次性登录和`BROWSER_TEST_CHANNEL=bundled`。原npm命令默认仍使用系统Chrome。`--specialist audio-timeline`只选择该命名脚本，结果按实际1项计；不使用skip/自动重试。证据、超时与服务清理均由runner拥有，独立结果不计入统一Chromium52条。

旧专项已同步现有契约：稳定style_id对应选项名称、role=alert、导入保留视窗后的显式Home、精确状态等待、显式选行可定位视频、时间戳下载及下载正文、同页导航与明确放弃未保存稿后清理；没有放宽预期时间/像素/PCM/清理断言或添加固定sleep。真实听感和OS权限仍需人工。

`--suite media --production-app`提供180秒/48kHz/5.1、16MiB文件预算的合成媒体闭环；`--suite platform --browser firefox|webkit`为兼容评估，mac14冻结WebKit的显式兼容驱动/生产选项与原失败记录见 [测试手册](../../docs/testing.md)。全部实际执行统计、失败历史、版本及待人工边界归该手册和 [覆盖矩阵](../../docs/testing-coverage.md)，不在本目录重复维护另一套结论。
