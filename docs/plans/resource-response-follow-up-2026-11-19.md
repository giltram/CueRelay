# 资源响应顺序复核修复

基线：806746e。范围：显式重载被等价的新状态检查取消、保存/拆分确认归档后被旧轮询解除、重返保留工作区的旧拒绝隐藏新成功、首次列表取消后无恢复入口、所有请求结束后的有效总数没有校正越界页。

执行计划：

1. 在正常 App UI 回归中控制响应顺序，断言修复后的文档、只读、草稿、重试和页码行为；先在基线复现。
2. 分开工作区状态接纳与显式文档替换资格；确认归档建立状态顺序屏障；路由加载反馈遵循同一顺序。
3. 同查询取消自动重试；用最后接纳的总数在请求结束后校正页码，并保留较新的错误反馈。
4. 重跑 resource-response-races、context-refresh、projects-refresh、全量单测及类型检查，同步模块契约和实测结果。

不改变 HTTP、持久化结构、编辑器文档/草稿/媒体所有权或保存冲突基准。


实现与契约：

- 工作区的状态顺序与显式文档替换资格分开；状态上下文仅保留已接纳成功的 revision/status。较新成功确认同一快照时允许显式重载，较新拒绝/归档确认/不同 revision 仍返回 false 保护草稿。
- 保存与拆分复用 confirmArchived，在收到 project_archived 时推进当前状态顺序；旧轮询失效，确认后新发出的恢复检查继续有效。路由错误遵循反馈版本，成功背景检查能恢复同一保留工作区的 ready 状态。
- 列表的最新取消直接重读当前查询；失败沿用现有错误/重试入口。查询生命周期记录最后接纳的有效末页，在全部请求收尾后补做校正；较新请求在途时旧总数不能提前翻页。请求开始和自动校正不清除较新错误，后续有效成功才清除。

2026-11-19 实际验证：

- 提供的 `/tmp/cuerelay-review.cMJDSW/recheck-806746e.mjs` 在修改产品代码前对五项全部输出 CONFIRMED；新增仓库 reload 回归在基线失败，收到的仍是旧字幕而非远端新字幕。
- `npm run test:resource-response-races` 八组全部通过，正常 UI 入口控制响应顺序。覆盖五项反馈、保存/拆分两条归档路径、真正较新恢复、较新 503 与有效旧总数的两种结束顺序、仍有新请求在途时不提前跳页。另核对保留编辑节点、IndexedDB 草稿在撤权后保留、成功重载后清理，以及当前路由错误被新成功检查恢复。
- `npm run test:context-refresh` 原有九组全部通过；`npm run test:projects-refresh` 三组输出全部通过。
- `npm test -- --run`：58 个文件、498 项通过，包含前端相对依赖无环与 diagnostics 边界检查。
- `npm run typecheck`、`npm run build`（含 877 项双语资源检查和 TypeScript）、`git diff --check` 通过。生产构建仍提示已有的大 chunk，未为此扩展改动范围。

架构评估：未增加模块依赖或循环，没有更改 HTTP/API、持久化数据结构或工作区文档/媒体所有权；没有实施无关重构。浏览器验证使用 Chromium（projects-refresh 使用安装的 Chrome）、真实合成媒体/codec/IndexedDB 和隔离 HTTP fixture，没有访问业务数据库；本轮未重跑真实后端 E2E 或完整双语布局套件。


## 三项审查补修

交接工作树在上述五项修复上新增回归：重返路由和较新轮询都失败时失去路由重试；隐藏期间发起的旧轮询成功清除较新路由错误；用户切换列表状态/搜索/页码时旧查询错误遗留。

执行步骤：先用当前生产构建复现仓库新测试，再限制路由恢复资格、隔离手动查询反馈，重新构建并运行独立探针 main/extra/isolation 及指定浏览器、单测、类型检查。

实现决定：

- 状态数据仍按 ReadOrder 接纳，不让较新暂时失败遮蔽有效旧状态；成功快照额外记录发起版本，路由 LoadState 记录本次读取版本。路由失败只有被已接纳的较新成功确认取代时才转 ready，较新失败本身不能授予恢复资格。背景成功可以更新状态，但只有发起不早于本次路由的检查才能恢复其 ready；旧隐藏轮询不清除较新路由错误。
- 列表资源/过滤条件变化清除旧反馈，用户翻页显式清除旧页反馈。同查询重试/后台刷新与自动页码校正保留仍相关的失败，直到有效成功恢复；旧查询在途请求继续由生命周期隔离。
- 新增 recovery / isolation 浏览器回归组，覆盖双 503、隐藏旧成功、路由重试和新检查恢复、内存节点/持久草稿保留，以及状态/搜索/手动页码切换、同查询重试反馈和旧查询迟到失败。修改产品代码前，两组在交接工作树的实际生产预览分别因路由错误消失、旧查询错误遗留失败。

2026-11-19 本轮实际验证：

- 先对本工作树 `npm run build`，启动专用生产预览 `http://127.0.0.1:5291`；产品修复前新 recovery/isolation 回归分别复现路由错误丢失、切状态遗留旧反馈。产品修复后再次构建，同一专用预览提供修改后的产物。
- 提供的 `/tmp/cuerelay-independent.ajdeet/probe.mjs http://127.0.0.1:5291 extra` 三项全部 PASS；main 十项、isolation 两项全部 PASS，包括等 revision 重载、较新拒绝/归档/不同 revision 时保护草稿、保存/拆分归档屏障、旧路由 403、取消重试、分页校正两种结束顺序、跨查询取消隔离和拒绝使旧总数失效。
- `RESOURCE_RACES_URL=http://127.0.0.1:5291 npm run test:resource-response-races` 十组全部通过。新 recovery 组验证两个暂时失败仍保留「重试加载」、隐藏旧成功不能消除新路由错误、直接重试/新检查可恢复、编辑节点及内存/持久草稿保留；isolation 组验证状态/搜索/手动页码切换、同查询重试反馈保留、切换后旧在途重试失败不重现。
- `CONTEXT_REFRESH_URL=http://127.0.0.1:5291 npm run test:context-refresh` 九组通过；`PROJECTS_REFRESH_URL=http://127.0.0.1:5291 npm run test:projects-refresh` 三组通过。
- `npm test -- --run`：58 文件、498 项全部通过，含相对源码依赖无环与 diagnostics 边界检查。`npm run typecheck`、`npm run build`（含 877 项双语资源检查）、`git diff --check` 通过。构建仅有已有的大 chunk 提示。

本轮未新增模块依赖或改变 HTTP/持久化契约；无需额外架构重构。验证使用本工作树生产构建、隔离 HTTP fixture、真实浏览器/合成媒体/codec/IndexedDB，不写业务数据库；未运行真实后端 E2E 或完整双语布局套件。


## 相邻边界补修

复核新增 P2：本次路由已由新检查恢复，后续新检查撤权，再迟到的旧路由 404 会隐藏只读编辑器并错误声称项目不存在。P3：第 2 页失败后重选当前状态标签回到第 1 页，遗留第 2 页反馈。另有基线 806746e 已存在的项目轮询错误无法在项目恢复后清除；该问题不归属于前两项新回归，但本轮一并修复其直接相关的反馈所有权。

计划与实现：

1. 用交接生产构建和提供的 adjacent 探针复现，再将精确顺序加入仓库：成功→撤权→旧路由 404、两种已选标签返回首页、重试的新路由门槛及项目成功不能清除组织/用户操作错误。
2. LoadState 本身记录路由发起版本及已恢复 ready 的事实。迟到路由失败通过函数式更新保留该事实；权限拒绝继续由独立状态顺序及 accessDenied 管理。无需在最近成功快照中另存版本，后续撤权不再抹掉路由已恢复事实。每次重试重新建立本次读取版本，旧成功不能满足新门槛。
3. 手动翻页和状态标签的页码重置统一使用 changePage；过滤条件变化继续隔离旧反馈，同查询重试和自动校正不调用手动清理。
4. app-workspace 独立持有当前状态上下文的 statusIssue，由 App 只读组合展示；成功状态反馈按 ReadOrder 清除，clear/adopt 及上下文/会话失效隔离旧错误。移除把轮询错误写进 App 通用用户消息的 onIssue 回调，避免项目恢复误清除导出等用户操作反馈或组织/设置错误。增加 feedback 回归：双 503、导出失败、项目重试/轮询成功后，项目错误消失，组织和导出失败仍可见。

修复前独立 adjacent 探针已在本工作树专用生产预览 5292 复现 P2/P3 和基线遗留反馈，旧成功不能恢复第二次路由尝试这一正向边界通过；输出为 `/tmp/cuerelay-adjacent-before-fix.log`。新测试组为 denial/attempt/reselect/feedback。

2026-11-19 本轮实际验证：

- `npm run build` 成功后使用本工作树生产产物的独立预览 `http://127.0.0.1:5292`。`/tmp/cuerelay-verify.Li1ocR/adjacent.mjs http://127.0.0.1:5292` 四项全部 PASS；旧 404 返回后编辑器仍可见且只读，只展示新拒绝；双 503 后完整恢复不再残留轮询错误；第二次路由尝试仍拒绝较早成功的恢复资格。
- `/tmp/cuerelay-independent.ajdeet/probe.mjs http://127.0.0.1:5292 main|extra|isolation` 分别十/三/两项全部 PASS，确认此前五项与上一轮三项继续通过。
- `RESOURCE_RACES_URL=http://127.0.0.1:5292 npm run test:resource-response-races` 十四组全部通过，新增 denial/attempt/reselect/feedback 四组。涵盖两个当前状态标签、已恢复后撤权和旧 404、第二次路由门槛、独立项目反馈恢复；feedback 还实测项目重试/轮询成功后组织不可用和用户导出失败均保留，只有项目检查错误消失。
- `CONTEXT_REFRESH_URL=http://127.0.0.1:5292 npm run test:context-refresh` 九组及 `PROJECTS_REFRESH_URL=http://127.0.0.1:5292 npm run test:projects-refresh` 三组通过。
- `npm test -- --run`：58 文件、498 项全部通过，包含相对源码依赖无环及 diagnostics 边界检查。`npm run typecheck`、`npm run build`（877 项双语资源检查）及 `git diff --check` 通过。构建仅保留已有大 chunk 提示。

本轮仅调整原有 App 与 app-workspace 的内部反馈接口、路由/权限状态职责及手动分页入口；无新增模块依赖、HTTP 或持久化契约变化，无需无关重构。生产浏览器验证使用隔离 HTTP fixture、真实媒体/codec/IndexedDB，不写业务数据库；未运行真实后端 E2E 或完整双语布局套件。


## 已恢复路由取消与搜索防抖补修

本轮范围：旧路由 401 被转换为 request_superseded 后仍无条件重读，隐藏已恢复编辑器；搜索在 250ms 内改回已生效查询，仍重置至首页并遗留原页错误。保留相对 806746e 的全部既有改动。

执行计划：

1. 加入 cancellation/search 浏览器回归，在修改产品代码前用当前生产构建复现。
2. 路由取消只在本次尝试尚未恢复时自动重读；本次恢复事实独立于后续权限变化，每次重试重新建立门槛。搜索只有最终值与已生效查询不同时才提交查询并重置页码。
3. 重新构建并启动专用生产预览；运行提供的 boundaries、adjacent、probe 三组及仓库资源竞态、上下文/列表刷新、前端单测、类型检查，记录实际结果与范围。


实现决定：

- RouteAttempt 独立拥有本次读取版本和 recovered 事实，由有效成功同步更新；LoadState 只投影 loading/ready/error。取消处理在触发重试前检查同一个尝试，已恢复则静默结束；普通旧错误也遵守该事实。后续撤权不会抹掉恢复资格，每次进入/重试新建尝试，旧隐藏检查仍不能满足新门槛。clear/adopt、路由清理和成功显式重载清除旧尝试，未引入第二份文档或权限状态。
- 搜索 effect 比较输入与已生效 query；相等时取消待提交定时器且不重置页码。真实变化仍在 250ms 后一起提交 query/第 1 页，由原查询生命周期隔离反馈。手动翻页、重选标签和自动校正沿用既有入口。
- cancellation 回归覆盖恢复后旧 401、恢复后再撤权的旧 401，断言没有额外请求、原编辑节点、内存/IndexedDB 草稿及当前权限；既有 authentication/attempt 继续检查首次取消自动重读与每次重试的新门槛。search 覆盖空/非空已生效查询，断言第 2 页、反馈、重试入口和请求数均保留，再验证真实查询变化回首页且隔离旧错误。

2026-11-19 本轮实际验证：

- 修改产品代码前先构建交接工作树，启动专用生产预览 `http://127.0.0.1:5294`。新增 cancellation/search 回归分别复现额外读取（3 而非 2）与无效首页请求（4 而非 3）。修复后重新 `npm run build`，上述预览提供修改后的实际产物。
- 提供的 `/tmp/cuerelay-recheck.GSIFsq/boundaries.mjs http://127.0.0.1:5294` 四项全部 PASS：原查询恢复后请求页码仍为 1/2/2，原页错误保留；旧路由 401 返回后仍仅两次读取、原编辑器可编辑且草稿保留；另外两项相邻反馈/状态标签边界通过。输出位于 `/tmp/cuerelay-boundaries-independent.log`。
- 同目录 adjacent.mjs 四项、probe.mjs main 十项 / extra 三项 / isolation 两项，共此前 19 项全部 PASS。覆盖已恢复后撤权/旧 404、路由重试门槛、双 503 反馈恢复，以及等 revision 重载、撤权/归档屏障、取消恢复与页码校正。输出为 `/tmp/cuerelay-boundaries-adjacent.log` 与 `/tmp/cuerelay-boundaries-probe-{main,extra,isolation}.log`。
- `RESOURCE_RACES_URL=http://127.0.0.1:5294 npm run test:resource-response-races` 十六组全部通过，包含新增 cancellation/search；`CONTEXT_REFRESH_URL=http://127.0.0.1:5294 npm run test:context-refresh` 九组、`PROJECTS_REFRESH_URL=http://127.0.0.1:5294 npm run test:projects-refresh` 三组全部通过。日志为 `/tmp/cuerelay-boundaries-{races,context,projects}.log`。
- `npm test -- --run`：58 文件、498 项通过，包括相对源码依赖无环与 diagnostics 边界检查；`npm run typecheck`、`npm run build`（877 项双语资源检查）与 `git diff --check` 通过。构建仍仅有已有的大 chunk 提示。单测/构建输出为 `/tmp/cuerelay-boundaries-{unit,build}.log`。

架构评估：本轮调整现有模块内部的路由尝试与搜索提交条件，没有新增模块依赖、循环或 HTTP/持久化契约变化；保留此前全部改动，无需额外架构重构。浏览器实测使用本工作树生产构建、Chromium/Chrome、隔离 HTTP fixture、合成媒体、真实 codec/IndexedDB，不写业务数据库；未运行真实后端 E2E、完整双语布局套件、其他浏览器或真实片源验收。
