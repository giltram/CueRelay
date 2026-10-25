# 保留的工作区

`useWorkspace` 拥有单个工作区实例、初始化 ProjectDetail/File、挂载代号、按路由加载状态、显式保存/重载和归档/权限观察。字幕正文、选中行、时间草稿、视频节点和播放状态仍唯一属于 EditorWorkbench/LocalVideoPlayer。

公开接口：workspace/visible/projectLoad/accessDenied；clear、adoptCreated、save、split、reload、updateSummary、retry。App 在获得切换许可后调用 clear；在列表点击新建时先处理该文档保留的旧稿保护，再打开本地单页表单；创建成功后把已有详情与所选 File 交给 adoptCreated，再 push 工作区 URL。创建表单不拥有页面路由，不新开标签页。初始化 File 只留本标签页内存，不放 URL/history/Storage。

路由进入项目时调用既有 projects-api.get，序号与 effect 清理隔离已过期响应。重返同组织同项目只更新归档状态，不替换内存文档或保存 revision；新标签页/刷新没有保留实例，加载服务器快照并要求重新选片校验。轮询/焦点检查也只观察状态，不悄悄接受远端 revision；撤权/不存在时禁止继续编辑并保留导出。显式 reload 在 App 的导出/取消/明确放弃流程后读取新快照并更换挂载代号。

浏览个人设置、同组织设置或列表时不 clear，不卸载 EditorWorkbench；隐藏时由既有 visible 契约暂停播放和快捷键。新标签页列表不改变本页路由或 visible，不主动暂停视频。只有跨项目/本地工作区/组织/账号的已确认替换和显式重载才能替换实例。没有多项目缓存、自动保存、跨标签页草稿同步或持久化。

依赖方向：App → app-workspace → project-data/contracts/navigation 的路由类型；workspace-ui 不依赖 app-workspace。单元路由检查及 projects/navigation/main-audio-integration 浏览器测试覆盖集成边界。

`split` 与 save 使用同一个 account request、显式 revision、updateSummary 与归档错误处理，经 projects-api.split 调用后端。只返回结果给 EditorWorkbench，由后者成功后替换自己的 document/savedRevision。请求期间编辑器冻结本次快照；失败继续保留当前内容。没有轮询采用远端文档或第二份字幕 store。项目拆分本身会保存完整工作快照（含当前时间草稿），详见 docs/editing-operations.md。

项目样式保存由独立 ProjectSettingsPage 直接调用 projectApi.styles，本模块不再提供样式回调。设置页保存不修改保留工作区的文档或 revision；旧工作区保存继续冲突，明确重载后才接受新样式。本地工作区保留样式管理，模板另存请求由 App 注入 JsonRequest / 当前组织 / 管理能力，不从编辑器读取账号内部状态。
