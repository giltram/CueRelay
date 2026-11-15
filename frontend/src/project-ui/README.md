# 项目面板

ProjectsPanel 负责组织项目列表（进行中/过去、搜索、分页、管理入口）；ProjectForm 负责名称/说明、媒体/ASS 初始化及可选版本化组织模板/脚本设置；ProjectSettingsPage 负责独立设置页的加载、名称/说明编辑、项目样式管理和冲突后的显式版本刷新。App 拥有当前组织和切换保护，app-workspace 拥有单个保留工作区，面板不读取 EditorWorkbench 内部状态。

公开输入是 Organization、contracts/http.JsonRequest、navigate、创建前保护/创建成功和生命周期回调。项目名称、项目设置、本地工作区使用 navigation.RouteLink 的真实 href；路径解析/生成不属于面板。所有 HTTP 契约封装在 project-data/projects-api.ts，DTO 在 contracts/projects.ts。media/media-manifest.ts 只负责本地媒体元数据与 Worker 完整 SHA-256，不依赖 UI/账号。

App 在成功加载会话上下文（组织/个人设置）后递增 `contextVersion`，通过 `refreshVersion` 显式通知列表更新；列表不依赖 Organization 对象引用变化触发请求。首次进入或切换状态/搜索/页码，没有当前查询数据时显示加载提示；后台更新同一查询时保留表格和分页交互，成功后更新数据，失败保留已有列表并提供重试。明确的权限/资源失效错误清除旧列表，组织移除及账号切换仍沿用 App 的组织上下文和挂载边界。请求序号继续隔离过期响应，后台更新不重置搜索、状态或页码。回归：`npm run test:projects-refresh`（真实 Chrome、内存 HTTP 夹具，不写开发数据库）。

同文档历史浏览列表保持 EditorWorkbench 挂载，但隐藏并暂停其播放和全局快捷键；默认新开列表不改变来源工作区；同文档历史重新进入同一项目恢复当前快照；默认链接新开标签页并加载独立服务器快照，切项目/组织/账号或重新加载先走导出/取消/明确放弃。App 的同账号会话刷新不会替换文档或接纳新的保存 revision。

归档只读；保存冲突保留字幕和时间草稿，重新加载需要明确放弃。项目保存仅包含已应用字幕，不含未应用时间、File 或视频；没有自动保存。文件完整匹配后才允许修改字幕。项目工作区不提供替换原始 ASS 导入；独立样式管理面板通过具名接口修改结构化样式/脚本，保留原始模板锚点。

验证：media/file-hash.test.ts、frontend/browser-tests/projects.mjs。浏览器播种脚本 backend/browser_tests/seed_projects.py 只接受新建的 cuerelay_projects_browser 数据库。

音频时间轴只接收已接受的同一 File 和只读字幕/草稿。边界点击只修改草稿，个人提交快捷键统一提交并下一行；项目保存仍只含已提交时间。新增固定删行组合键和边界回调遵守同一 canEdit/弹窗暂停保护。跨模块回归见 `frontend/browser-tests/main-audio-integration.mjs`。

工作区列表、项目名称/项目设置和本地工作区链接默认新开标签页；同页历史返回列表才隐藏现有编辑器。「新建项目」是当前列表的按钮，经 App 的旧稿保护后设置本地 form=new 并打开 ProjectForm，不改地址或新增标签页。名称/说明和视频/字幕都在同一表单，没有上一步/下一步。成功显式传递 ProjectDetail 和本页选择的 SelectedVideo（File/可选只读句柄），App adopt 后 push 工作区地址；取消仅关闭弹窗。File 不放 history state，不跨窗口传递。登录/直达/刷新继续指定项目和错误状态由 App/app-workspace/navigation 组合处理。回归入口新增 browser-tests/navigation.mjs。

项目列表的更新者和归档者直接显示 username，与 Session/成员身份一致，不存在显示名字段或名称回退。

项目列表页头右上角「设置」导航由 App 注入，设置页归 account-ui。列表不提供「返回工作区」；仅同文档浏览器历史恢复保留实例；默认点击项目入口使用独立新标签页。

文件选择取消：原生 input[type=file] 的 cancel 会冒泡，Modal 仅处理 target=currentTarget 的弹窗自身取消；视频/ASS 选择器取消不关闭弹窗，不清除名称、说明或之前校验成功的文件。空文件 change 也直接忽略。视频校验、ASS 预检完成前禁止创建；失败保留表单以便重试。浏览器复现/回归：project-form.mjs；旧创建地址兼容测试在 navigation/routes.test.ts。

项目列表所有成员均有「项目设置」入口；管理员另有「归档项目」或「恢复项目」，无折叠菜单或打开按钮；点击项目名称进入工作区。「项目设置」默认新开 `/organizations/:organizationId/projects/:projectId/settings`。设置页自行调用 project-data 获取目标详情，不挂载或接纳字幕工作区；只允许 can_manage 且未归档的项目修改名称/说明。所有成员可管理活动项目样式，归档时仅查看，无需选择视频。设置页组合 style-ui/ProjectStyleManager，以 subtitle-model/cue-order 提供已保存字幕的显示顺序，不依赖 workspace-ui 内部实现。

项目设置页不提供「返回项目列表」按钮；页头 CueRelay 首页链接和浏览器历史继续可用。

设置页元数据保存、样式保存、显式刷新共用一份 ProjectDetail/revision 和 busy 状态；名称/说明草稿独立保留。每次打开样式管理前读取最新项目，成功后才打开弹窗，失败保留页面与输入；自动刷新和样式保存成功只更新未修改的元数据字段；若名称/说明同字段也有远端竞争，标记待核对，显式刷新前禁止覆盖，避免样式版本前进绕过元数据冲突。样式保存使用已保存文档，不提交工作区未保存的字幕/时间输入。`project-data/project-style-save.ts` 唯一拥有一次安全重试：仅明确 project_conflict 且最新 source/styles/script 全部未变时，用最新完整文档与 revision 重试；分配样式还检查目标 Cue 存在且原分配未变。任何样式定义变化均保守拒绝合并，使用数/权限/格式继续由后端验证；网络失败、模板冲突、归档和第二次竞争不重试。最终失败保留输入和旧基准，显式刷新展示服务器最新名称/说明并更新保存基准。设置页不直接更新保留工作区的文档或 revision；工作台可在显式保存时安全合并仅样式的远端变化，具体基准/历史保护见 app-workspace 与 workspace-ui README，真实字幕竞争仍保留冲突。直接访问、登录后继续和刷新均保留目标组织/项目；不存在/无权限/归档有明确状态。策略测试：`project-data/project-style-save.test.ts`；真实数据库回归：`WorkspaceRegressionTests.test_project_styles_refresh_and_retry`。`npm run test:project-settings`、`npm run test:style-management` 使用 HTTP 测试夹具，不访问开发数据库。

本次验证及限制见 [项目设置记录](../../../docs/experiments/project-settings.md)。

本机片源恢复：ProjectForm 复用 media/VideoFilePicker，在支持的安全上下文中使用文件句柄选择器，其他环境/选择器失败时回退普通文件 input；取消保留原选择。SelectedVideo 只经创建回调与 app-workspace 显式传给播放器，不进入创建请求。句柄仅由媒体模块在播放器校验后持久化；完整职责和浏览器测试见 [media README](../media/README.md)。

项目设置另组合公开 glossary-ui/GlossarySettings：项目默认只读组织当前表，活动项目成员可显式fork当前组织词条成为项目副本，再自由添加/编辑；organizer/dev可切回组织默认，副本不合并删除。表单/分页和工作区共用 glossary-data，不导入工作区内部。术语保存及关联使用独立 token，不读取/更新本页 ProjectDetail 的字幕 revision，不提交样式或其他工作区草稿；归档只读。详见 [术语模块](../glossary-ui/README.md) 与 `npm run test:glossary`。
