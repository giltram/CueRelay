# 项目面板

ProjectsPanel 负责组织项目列表（进行中/过去、搜索、分页、管理入口）；ProjectForm 负责名称/说明、媒体/ASS 初始化及可选版本化组织模板/脚本设置；ProjectSettingsPage 负责独立设置页的加载、名称/说明编辑和冲突后的显式版本刷新。App 拥有当前组织和切换保护，app-workspace 拥有单个保留工作区，面板不读取 EditorWorkbench 内部状态。

公开输入是 Organization、contracts/http.JsonRequest、navigate、创建前保护/创建成功和生命周期回调。项目名称、项目设置、本地工作区使用 navigation.RouteLink 的真实 href；路径解析/生成不属于面板。所有 HTTP 契约封装在 project-data/projects-api.ts，DTO 在 contracts/projects.ts。media/media-manifest.ts 只负责本地媒体元数据与 Worker 完整 SHA-256，不依赖 UI/账号。

同文档历史浏览列表保持 EditorWorkbench 挂载，但隐藏并暂停其播放和全局快捷键；默认新开列表不改变来源工作区；同文档历史重新进入同一项目恢复当前快照；默认链接新开标签页并加载独立服务器快照，切项目/组织/账号或重新加载先走导出/取消/明确放弃。App 的同账号会话刷新不会替换文档或接纳新的保存 revision。

归档只读；保存冲突保留字幕和时间草稿，重新加载需要明确放弃。项目保存仅包含已应用字幕，不含未应用时间、File 或视频；没有自动保存。文件完整匹配后才允许修改字幕。项目工作区不提供替换原始 ASS 导入；独立样式管理面板通过具名接口修改结构化样式/脚本，保留原始模板锚点。

验证：media/file-hash.test.ts、frontend/browser-tests/projects.mjs。浏览器播种脚本 backend/browser_tests/seed_projects.py 只接受新建的 cuerelay_projects_browser 数据库。

音频时间轴只接收已接受的同一 File 和只读字幕/草稿。边界点击只修改草稿，个人提交快捷键统一提交并下一行；项目保存仍只含已提交时间。新增固定删行组合键和边界回调遵守同一 canEdit/弹窗暂停保护。跨模块回归见 `frontend/browser-tests/main-audio-integration.mjs`。

工作区列表、项目名称/项目设置和本地工作区链接默认新开标签页；同页历史返回列表才隐藏现有编辑器。「新建项目」是当前列表的按钮，经 App 的旧稿保护后设置本地 form=new 并打开 ProjectForm，不改地址或新增标签页。名称/说明和视频/字幕都在同一表单，没有上一步/下一步。成功显式传递 ProjectDetail 和本页选择的 File，App adopt 后 push 工作区地址；取消仅关闭弹窗。File 不放 history state，不跨窗口传递。登录/直达/刷新继续指定项目和错误状态由 App/app-workspace/navigation 组合处理。回归入口新增 browser-tests/navigation.mjs。

项目列表的更新者和归档者直接显示 username，与 Session/成员身份一致，不存在显示名字段或名称回退。

项目列表页头右上角「设置」导航由 App 注入，设置页归 account-ui。列表不提供「返回工作区」；仅同文档浏览器历史恢复保留实例；默认点击项目入口使用独立新标签页。

文件选择取消：原生 input[type=file] 的 cancel 会冒泡，Modal 仅处理 target=currentTarget 的弹窗自身取消；视频/ASS 选择器取消不关闭弹窗，不清除名称、说明或之前校验成功的文件。空文件 change 也直接忽略。视频校验、ASS 预检完成前禁止创建；失败保留表单以便重试。浏览器复现/回归：project-form.mjs；旧创建地址兼容测试在 navigation/routes.test.ts。

项目列表操作直接显示「项目设置」「归档项目」，过去项目直接显示「恢复项目」，无折叠菜单或打开按钮；点击项目名称进入工作区。「项目设置」默认新开 `/organizations/:organizationId/projects/:projectId/settings`。设置页自行调用 project-data 获取目标详情，不挂载或接纳字幕工作区；只允许 can_manage 且未归档的项目修改名称/说明。保存提交 revision，成功留在当前设置页；冲突/失败保留输入，显式刷新展示服务器最新名称/说明并更新表单基准 revision。设置页不更新保留工作区的 revision，避免旧字幕绕过并发保存校验。直接访问、登录后继续和刷新均保留目标组织/项目；不存在/无权限/归档有明确状态。回归：`npm run test:project-settings` 使用 HTTP 测试夹具，不访问开发数据库。

本次验证及限制见 [项目设置记录](../../../docs/experiments/project-settings.md)。
