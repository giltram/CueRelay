# 浏览器诊断 v1

默认启用，工具栏「导出诊断信息」直接下载单个缩进 JSON，不请求后端、不上传、不提交字幕、不移动媒体、不调用 undo/redo。登录页和初始会话检查页也有入口。诊断文件包含实际编辑的字幕正文，发送前可自行查看。

## 所有权与接入

`diagnostics` 是叶子模块，只依赖浏览器 API。`schema.ts` 定义格式/预算，`safety.ts` 负责安全投影，`recorder.ts` 负责有限内存/顺序/账号代次，`storage.ts` 负责 IndexedDB，`http.ts` 是无业务知识的 HTTP 包装，`export.ts` 生成摘要与下载。`index.ts` 组合全局异常监听、显式状态提供者与可选跨标签页身份失效通知。

业务模块显式调用 `diagnostics.record(module, action, outcome, EventData, scope?, context?)`。异步任务开始时捕获 `scope()` 和 `contextSnapshot()`，完成时交回，防止旧任务误归新账号或新页面。`reportFailure(module, action, reason, origin, operationId?)` 必须接收操作开始时由 `captureDiagnosticOrigin()` 捕获的 scope/context，不提供报告时的默认归属；同账号切页保留原组织/项目，账号代次变化则丢弃旧错误。它区分 error/conflict/cancelled/stale/unknown，原始异常留在业务显示路径。`noteIgnored` 只聚合配置过的快捷键被 IME、焦点、只读、隐藏或弹窗阻止的次数/原因，不采集原生键值。

`workspace-ui/edit-diagnostics.ts` 只观察现有不可变 EditState 引用；连续输入/手势合并后生成逐行增量，包含前后正文、时间、样式引用、删除/增加，以及白名单样式和脚本字段。`use-edit-history` 在现有分组边界通知观察器，诊断自己的停输定时器和导出 flush 不结束历史分组。IME、粘贴及未失焦输入通过已生效的业务状态采集。没有第二份可写字幕状态，不保存原始 ASS source 或完整快照，记录不能恢复文档。

App 提供页面类型与组织/项目 ID、经实际会话响应确认账号；EditorWorkbench 通过 `provideWorkspaceStatus` 提供只读 getter，包含该工作区自己的 projectId/visible，避免隐藏保留实例的 revision 被误认成当前页面项目版本。字幕、File、PCM、revision、保存基准、撤销历史仍归原模块。媒体/Worker 只向诊断叶子报告，不依赖账号或工作区。诊断不反向导入或操纵业务模块。

## 安全与账号生命周期

只接受 EventData 中明确字段。请求记录只有随机 UUID、方法、路由模板、状态及耗时；不观察 headers/body/response body/console/Storage。查询串、任意路径、密码、Cookie、Session、CSRF、Authorization、API key、租约 token、媒体字节/PCM/帧/截图、文件名和媒体摘要均不收集。正文/样式字符串限制长度，并处理可识别的凭证赋值、Bearer、JWT、API key 及本地路径。此处理不是任意字幕文本的秘密检测器；业务正文以外没有表单输入采集。

错误不复制原始 message（可能回显无标签密码）；仅保留类型、固定中文说明及最多 12 个安全源码位置。Worker 在其边界生成同样的安全错误结构，主线程处理 Worker error/messageerror 和已展示的业务错误。不会监听原始 console。

IndexedDB 单一 control 行包含当前 owner/epoch；账号切换或退出在同一事务清空旧记录并更换代次。每次批写/导出都检查代次；旧标签页不能把旧数据写回或导出。BroadcastChannel 只传 owner/epoch 失效通知，不同步字幕或业务状态。导出只含当前组织的事件及不带组织的通用事件；状态提供者同时检查账号与组织。旧账号的异步结果和未刷新的文本观察器不能写入新账号。

持久化失败时继续有限内存；只读 control 检查或 BroadcastChannel 保证隔离。如果两者都不可用，保守隐藏账号事件与工作区状态，仅导出安全的通用错误/请求观测，并明确缺失。刷新后必须先确认当前账号才读取旧账号记录；离线刷新无法验证身份时不读取此前正文。外部 Admin/其他应用修改 Cookie 只能在现有会话观测发生后识别，不把本地诊断代次当作认证凭证。

## 预算与持久化

- 全部标签页共用的持久事件：最多 1500 条、逻辑事件 JSON 共 2MiB、每条 16KiB、保留 24 小时；每页内存同样有界。数据库索引/包装行存在少量额外开销。
- 正文单字段最多 4096 UTF-16 code units；字段更短的 ID/原因/样式另有上限。超大事件替换为 `event_size_limit`，安全处理/截断会标记 `truncated`。
- 每 2 秒异步批写新事件，不逐操作序列化整份记录。身份确认/切换取消待写定时器时同步清空句柄，让新身份的下一条事件重新调度。游标读取有界缓存，按旧事件优先淘汰。刷新、导出、后续批写会清理过期记录；关闭浏览器时不后台运行过期清理。
- 内存保存待写事件和有限近期持久记录；导出前刷新观察器并读取持久缓冲。每次存储等待最多 2 秒（失败后的只读隔离检查另有最多 2 秒）；并发 flush 合并，导出在已有批次之后最多再刷新一次新入队事件。浏览器挂起/突然崩溃不保证最后一批落盘。
- 导出事件预算独立限制为上述 2MiB，缩进后的下载硬上限 8MiB；无服务端读取。失败保留原记录并显示简短重试提示。
- coverage 报告预算、当前页面观察到的淘汰计数、截断数与存储降级。计数不承诺跨关闭页面累计；记录窗口不是完整审计。

## 格式与请求关联

固定键顺序：`summary`（中文、由实际观测派生）、`environment`（构建/页面/能力/只读状态）、`events`、`metadata`（formatVersion=1、coverage、采集说明）。前端可用 `VITE_CUERELAY_BUILD=release-2026.10.30 npm run build` 显式注入公开构建标签；构建来自 `VITE_CUERELAY_BUILD` 和服务端 `X-CueRelay-Build`，未配置明确 `unknown`。浏览器只投影浏览器/系统家族及版本，不保存完整 UA。

事件含 `tabId`、`sessionId`、`sequence`、墙上时间与单调 `elapsedMs`。当前 tabId 标记本次页面标签页来源，刷新创建新来源和新页面会话；旧事件保留其原来源。按同 sessionId 的 sequence 分析先后，不仅靠跨来源时间。`id` 标识事件；`operationId` 可关联已处理错误的操作；`requestId` 只追踪一次 HTTP 请求，未来 command_id 另行定义，本次没有协作协议。

`account-ui/api` 和 ASS/样式客户端共用 diagnosticFetch，不重复维护传输逻辑。开始/完成使用同一 X-Request-ID。HTTP 409 是冲突；网络未收到响应是 `unknown/no_response_result_unknown`，不能断言服务端未提交。主动 AbortSignal 是 cancelled。浏览器 `onLine` 单独展示，服务器可达性为 unknown。错误对象携带 requestId，模块错误可关联请求。

服务端关联/轮换/查询见 [backend/diagnostics](../../../backend/diagnostics/README.md)。代理在进入 Django 前拒绝的请求不会有 Django 日志，只能从浏览器 requestId 和代理日志排查。

## 验证与限制

纯测试：`npm test -- --run`，含本目录 boundaries.test.ts 的模块循环/叶子依赖检查，关注本目录、`workspace-ui/edit-diagnostics.test.ts` 和既有历史测试。真实 Chrome：代码修改完成后启动干净进程 `npm run dev -- --port 5194`（测试期间不热更新源码），再 `npm run test:diagnostics`（包含 `diagnostics-errors.mjs`：真实项目设置页延迟保存失败前切组织/切账号）；可通过 DIAGNOSTICS_URL 指定服务。现有历史回归：`HISTORY_URL=http://127.0.0.1:5194/workspace/local npm run test:workspace-history`。

没有会话回放、自动修复/上传、恢复业务数据、日志搜索页、服务端日志下载或开发者控制台。只观测已接入模块和近期窗口；摘要不推断根因。Safari/Firefox、真实磁盘耗尽及崩溃最后一批丢失尚需实机验收。故障注入和实际执行结果见 [验证记录](../../../docs/experiments/diagnostics-v1.md)。
