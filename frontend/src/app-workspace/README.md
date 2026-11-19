# 保留的工作区

`useWorkspace` 拥有单个工作区实例、初始化 ProjectDetail/File、挂载代号、按路由加载状态、显式保存/重载和归档/权限观察。字幕正文、选中行、时间草稿、视频节点和播放状态仍唯一属于 EditorWorkbench/LocalVideoPlayer。

公开接口：workspace/visible/projectLoad/accessDenied/statusIssue；clear、adoptCreated、save、split、reload、updateSummary、checkDraftRevision、retry。checkDraftRevision 供草稿恢复读取当前服务端 revision，不改变保留实例的保存基准。save 接收 contracts/projects.ProjectSaveRequest（document、上次成功保存的 baseDocument/revision、历史所需样式 ID），返回 ProjectSaveResult（project 摘要和实际保存 document）；基准与历史信息只在内存传递，不进入 HTTP。App 在获得切换许可后调用 clear；在列表点击新建时先处理该文档保留的旧稿保护，再打开本地单页表单；创建成功后把已有详情与所选 File/可选只读句柄交给 adoptCreated，再 push 工作区 URL。创建表单不拥有页面路由，不新开标签页。初始化 File 只留本标签页内存，不放 URL/history/Storage；media 模块在播放器校验通过后仅将句柄存入本机 IndexedDB。

路由进入项目时调用既有 projects-api.get，序号与 effect 清理隔离已过期响应。重返同组织同项目只更新归档状态，不替换内存文档或保存 revision；新标签页/刷新没有保留实例，加载服务器快照；media 按当前账号、组织、项目和媒体基准尝试恢复本机句柄，重新完整校验，失败则手动选片。轮询/焦点检查也只观察状态，不悄悄接受远端 revision；撤权/不存在时禁止继续编辑并保留导出。显式 reload 在 App 的导出/取消/明确放弃流程后读取新快照并更换挂载代号。

同一账号/项目的路由读取、显式 reload 和后台状态观察共用 request-state/ReadOrder。成功状态及明确 permission_denied/not_found 按数据版本排序，暂时失败只影响反馈；路由恢复资格与通用反馈顺序分开：每次路由建立独立 RouteAttempt，同步记录读取版本及已恢复事实，LoadState 只负责展示加载/就绪/错误；较新成功恢复后，即使随后撤权，迟到的旧路由错误也不能隐藏已恢复的只读编辑器或带来过时的不存在提示。每次路由重试建立新的读取门槛。只有本次路由或已接纳的较新成功能建立 ready；较新轮询和路由都暂时失败时保留路由错误及重试入口。背景成功仍可接纳状态数据，但发起早于本次路由的隐藏轮询不能清除其加载/错误状态。发起晚于路由的有效成功能恢复访问及 ready，不替换文档。save/split 返回 project_archived 时，在响应确认时推进状态版本并清空快照确认信息；已经发出的 active 轮询不能解除归档，只允许确认后发出的成功检查恢复。两个写入路径复用 confirmArchived，且只作用于开始写入时的原状态上下文。

clear/adoptCreated、本地实例替换或会话禁用使旧状态上下文失效。后台观察的旧反馈和 request_superseded 静默丢弃；本次路由读取若被身份确认取代，仅在尚未恢复时重新读取当前资源，避免停在加载状态；已经恢复的尝试静默忽略迟到取消，不增加请求、不隐藏编辑器，也不改变后续撤权形成的只读状态。状态上下文只另存最近接纳成功的 revision/status，不保存第二份远端文档。显式 reload 若仍是有效状态响应，则采用文档；若已有更新成功检查确认相同 revision/status，也可完成用户授权的文档替换。更新拒绝、归档确认或不同 revision 阻止旧快照替换，reload 返回 false，App 保留原实例及 IndexedDB 草稿，不将旧快照视为已完成替换。集成回归见 `npm run test:resource-response-races`，覆盖真实片源验证、403/404、轮询/重返/重载乱序、双 503/隐藏旧轮询与新检查或直接重试恢复、已恢复路由迟到取消无多余请求、保存及拆分归档、保留的编辑节点和持久草稿保护。

App 以登录会话启用工作区加载，请求由项目接口校验访问权限。个人设置独立加载，工作台先使用当前账号已知设置或默认值，设置更新通过 props 应用到原实例。

浏览个人设置、同组织设置或列表时不 clear，不卸载 EditorWorkbench；隐藏时由既有 visible 契约暂停播放和快捷键。新标签页列表不改变本页路由或 visible，不主动暂停视频。只有跨项目/本地工作区/组织/账号的已确认替换和显式重载才能替换实例。App 按挂载实例传入账号、组织和项目范围供工作台保护本机草稿。草稿存储由 [workspace-drafts](../workspace-drafts/README.md) 管理。本机媒体句柄依旧独立于字幕与历史。

依赖方向：App → app-workspace → project-data/contracts/request-state/navigation 的路由类型及 media 的 SelectedVideo/InitialVideo 类型；workspace-ui 不依赖 app-workspace。request-state 是无外部依赖的读取顺序策略。单元路由检查及 projects/navigation/main-audio-integration 浏览器测试覆盖集成边界。

`split` 与 save 使用同一个 account request、显式 revision、updateSummary 与归档错误处理，经 projects-api.split 调用后端。只返回结果给 EditorWorkbench，由后者成功后替换自己的 document/savedRevision。请求期间编辑器冻结本次快照；失败继续保留当前内容。没有轮询采用远端文档或第二份字幕 store。项目拆分本身会保存完整工作快照（含当前时间草稿），详见 docs/editing-operations.md。

项目样式保存由独立 ProjectSettingsPage 直接调用 projectApi.styles，本模块不再提供样式回调。设置页保存不直接修改保留工作区的文档或 revision。工作台显式保存发生明确冲突时，project-data/project-document-save 检查远端 cues 与已保存基准完全相同、source 不变、本地未修改定义且所有历史样式引用仍存在，才组合最新样式/脚本和本地 cues，以最新 revision 重试一次。成功返回实际保存的快照给 EditorWorkbench；失败不接纳版本，媒体/实例不替换。显式重载继续提供放弃草稿后完全接纳远端的路径。本地工作区保留样式管理，模板另存请求由 App 注入 JsonRequest / 当前组织 / 管理能力，不从编辑器读取账号内部状态。

工作区编辑历史由 workspace-ui/use-edit-history 拥有，不进入本模块。save/split 返回的最新 revision 和保存基准不随撤销回退；撤销拆分只恢复本地快照，不调用本模块持久接口。隐藏保留同一挂载实例和历史；reload/clear/adoptCreated 或跨项目/组织/账号替换通过挂载 generation 建立新历史。回归新增 browser-tests/workspace-history.mjs。

诊断：save/split 请求复用 project-data 的 HTTP 关联；显式 reload 报告阶段/revision。诊断无权更换本模块实例或保存基准；实际工作区状态由 EditorWorkbench 的只读接口提供。见 ../diagnostics/README.md。

术语维护和关联由独立 glossary-data/UI 处理，不调用本模块 save/split/updateSummary，不接纳远端字幕 revision。保留/隐藏的实例仍遵循原生命周期；术语入口复用 visible、账号归属和可访问性，账号/项目切换不能将旧响应写入新上下文。见 docs/glossary.md 和 browser-tests/glossary.mjs。

## 中英文展示边界（2026-11-15）

statusIssue 以 contracts/messages.MessageValue 保留当前项目检查错误，App 只负责格式化与组合展示。错误归属状态上下文，按反馈版本在成功检查时清除；不写入或清除 App 的组织/设置错误及用户操作消息。语言不参与保留实例、generation、路由加载、save/split 或权限观察的依赖；不因文案重新请求/重建工作区。完整维护/语言验收流程见 [国际化文档](../../../docs/internationalization.md)。
