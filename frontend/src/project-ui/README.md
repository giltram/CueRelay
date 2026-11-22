# 项目面板

## member权限（2026-11-22）

项目列表创建/归档/恢复、元数据、样式定义、字幕样式分配、术语fork/编辑/切回、模板另存分别消费有效权限。设置页继续可浏览，样式面板按模式独立禁用写入，模板另存可独立授权；成员管理不在本模块。规则见 [成员权限](../../../docs/member-permissions.md)，默认保持原角色行为。


初始字幕选择现在接受 ASS / SRT。SRT 经 `project-data/subtitle-api → /api/srt/import` 转为含完整 ASS source 的 v2 文档，使用新文档既有 Default/脚本默认值；选中后的脚本设置、显式组织模板导入仍沿原初始化规则。创建继续提交 ASS source，不增格式字段/第二份模型；已有项目仍不允许文件替换。编码、舍入和标签限制见 [SRT 格式契约](../../../backend/srt_format/README.md)，实际创建/保存/重载回归见 regression/srt.spec.mjs。

ProjectsPanel 负责组织项目列表（进行中/过去、搜索、分页、管理入口）；ProjectForm 负责名称/说明、媒体/字幕初始化及可选版本化组织模板/脚本设置；ProjectSettingsPage 负责独立设置页的加载、名称/说明编辑、项目样式管理和冲突后的显式版本刷新。App 拥有当前组织和切换保护，app-workspace 拥有单个保留工作区，面板不读取 EditorWorkbench 内部状态。

公开输入是 Organization、localOrganizationId、localScopeReady、contracts/http.JsonRequest、navigate、创建前保护/创建成功和生命周期回调。localOrganizationId 由 App 的路由/选择 ID 提供，已知显式组织时本地工作区链接不等待 Organization 返回；默认组织尚未确定时，localScopeReady=false 使同一入口禁用，成功确定组织或确认没有组织后才开放，避免入口范围随首次加载变化而找不到旧稿。项目 API 仍只使用已解析的 Organization。项目名称、项目设置、本地工作区使用 navigation.RouteLink 的真实 href；路径解析/生成不属于面板。所有 HTTP 契约封装在 project-data/projects-api.ts，DTO 在 contracts/projects.ts。media/media-manifest.ts 只负责本地媒体元数据与 Worker 完整 SHA-256，不依赖 UI/账号。

App 在接纳组织列表后通过其 `readVersion` 作为 `refreshVersion` 显式通知列表更新，不等待个人设置；列表不依赖 Organization 对象引用变化触发请求。首次进入或切换状态/搜索/页码，没有当前查询数据时显示加载提示；后台更新同一查询时保留表格和分页交互。同查询的重试/后台刷新共用一个 request-state/ReadOrder，不因新请求开始而作废旧请求，成功响应按数据版本接纳；暂时失败只更新反馈，不能遮蔽较早的有效列表或权限拒绝。明确的权限/资源失效错误按权威数据版本清除旧列表，较新成功结果阻止旧拒绝清空新数据。切组织/查询/可用性或卸载时换掉 ReadOrder，隔离旧生命周期的成功和失败；组织移除及账号切换继续沿用 App 的挂载边界。后台更新不重置搜索、状态或页码。搜索经 250ms 防抖后，仅在最终输入与已生效查询不同时提交查询并重置到第 1 页；防抖期间改回原查询保留当前页、反馈和请求数。回归：`npm run test:projects-refresh`（真实 Chrome、内存 HTTP 夹具，不写开发数据库）；组织慢响应、早打开本地工作区和退出组织后慢设置见 `npm run test:context-refresh`。

列表的 pending 计数属于同一查询生命周期，所有请求在 finally 中收尾，包括 request_superseded、旧数据/旧错误被忽略的路径；旧查询收尾不能修改新查询的 loading。最新发起的读取被身份确认取代时，直接重试当前查询，不依赖组织刷新成功；重试失败沿用现有错误与「重试」入口，避免无数据、无反馈且无操作的空白状态。

数据接纳与页码校正分开：旧成功结果可以补齐当前页数据并记录有效末页，但较新检查仍在途时不能自动回退。最新成功确认越界可立即校正；所有请求收尾后按最后接纳的有效总数校正，较新 503 等暂时失败不使该总数失效。明确权限/资源拒绝清除总数及行数据。同查询发起读取/重试和自动校正页码不清除现有错误，只有可接纳的成功反馈才清除，保留较新失败而不让旧成功抹掉提示。切换组织/可用性/状态/搜索清除旧查询反馈，用户手动翻页与重选当前状态标签引起的页码重置统一经 changePage 清除旧页错误；两者与自动校正区分，避免新查询仍显示旧错误和重试按钮。上述边界的回归见 `npm run test:resource-response-races` 的 completion/pagination/settled/isolation/reselect/search 组。

同文档离开工作区前检查未保存改动；无改动或保存成功后浏览列表保持 EditorWorkbench 挂载，但隐藏并暂停其播放和全局快捷键；明确放弃则清除原实例和活跃草稿；默认新开列表不改变来源工作区；同文档历史重新进入同一项目恢复当前快照；默认链接新开标签页并加载独立服务器快照，离开工作区、切项目/组织/账号或重新加载按实际未保存状态提供保存并离开、导出备份、取消或明确放弃。App 的同账号会话刷新不会替换文档或接纳新的保存 revision。

归档只读；保存冲突保留字幕和时间草稿，重新加载需要明确放弃。项目保存仅包含已应用字幕，不含未应用时间、File 或视频；没有自动保存。文件完整匹配后才允许修改字幕。项目工作区不提供替换原始字幕文件导入；独立样式管理面板通过具名接口修改结构化样式/脚本，保留原始模板锚点。

验证：media/file-hash.test.ts、frontend/browser-tests/projects.mjs。浏览器播种脚本 backend/browser_tests/seed_projects.py 只接受新建的 cuerelay_projects_browser 数据库。

音频时间轴只接收已接受的同一 File 和只读字幕/草稿。边界点击只修改草稿，个人提交快捷键统一提交并下一行；项目保存仍只含已提交时间。新增固定删行组合键和边界回调遵守同一 canEdit/弹窗暂停保护。跨模块回归见 `frontend/browser-tests/main-audio-integration.mjs`。

工作区列表、项目名称/项目设置和本地工作区链接默认新开标签页；同页历史返回列表才隐藏现有编辑器。「新建项目」是当前列表的按钮，经 App 的旧稿保护后设置本地 form=new 并打开 ProjectForm，不改地址或新增标签页。名称/说明和视频/字幕都在同一表单，没有上一步/下一步。成功显式传递 ProjectDetail 和本页选择的 SelectedVideo（File/可选只读句柄），App adopt 后 push 工作区地址；取消仅关闭弹窗。File 不放 history state，不跨窗口传递。登录/直达/刷新继续指定项目和错误状态由 App/app-workspace/navigation 组合处理。回归入口新增 browser-tests/navigation.mjs。

项目列表的更新者和归档者直接显示 username，与 Session/成员身份一致，不存在显示名字段或名称回退。

项目列表页头右上角「设置」导航由 App 注入，设置页归 account-ui。列表不提供「返回工作区」；仅同文档浏览器历史恢复保留实例；默认点击项目入口使用独立新标签页。

初始字幕是基准视频下方的可选文件项。选中后显示文件名并可更换或移除。字幕预检失败时须更换或移除该文件才可创建。更换以新文件为样式和脚本设置的基准，移除恢复空文档的基准。视频与已选字幕均通过校验后，「创建并打开」提交已验证的 ASS 源文本（SRT 已转换），留空时提交 `source: null`。

原生 input[type=file] 的 cancel 会冒泡，Modal 仅处理 target=currentTarget 的弹窗自身取消。取消文件选择和空文件 change 均保留表单及当前文件。回归见 `npm run test:project-form`，旧创建地址兼容测试在 navigation/routes.test.ts。

项目列表所有成员均有「项目设置」入口；管理员另有「归档项目」或「恢复项目」，无折叠菜单或打开按钮；点击项目名称进入工作区。「项目设置」默认新开 `/organizations/:organizationId/projects/:projectId/settings`。设置页自行调用 project-data 获取目标详情，不挂载或接纳字幕工作区；修改名称/说明需edit_project且未归档；管理活动项目样式需manage_project_styles，归档时仅查看，无需选择视频。设置页组合 style-ui/ProjectStyleManager，以 subtitle-model/cue-order 提供已保存字幕的显示顺序，不依赖 workspace-ui 内部实现。

项目设置页不提供「返回项目列表」按钮；页头 CueRelay 首页链接和浏览器历史继续可用。

设置页元数据保存、样式保存、显式刷新共用一份 ProjectDetail/revision 和 busy 状态；名称/说明草稿独立保留。每次打开样式管理前读取最新项目，成功后才打开弹窗，失败保留页面与输入；自动刷新和样式保存成功只更新未修改的元数据字段；若名称/说明同字段也有远端竞争，标记待核对，显式刷新前禁止覆盖，避免样式版本前进绕过元数据冲突。样式保存使用已保存文档，不提交工作区未保存的字幕/时间输入。`project-data/project-style-save.ts` 唯一拥有一次安全重试：仅明确 project_conflict 且最新 source/styles/script 全部未变时，用最新完整文档与 revision 重试；分配样式还检查目标 Cue 存在且原分配未变。任何样式定义变化均保守拒绝合并，使用数/权限/格式继续由后端验证；网络失败、模板冲突、归档和第二次竞争不重试。最终失败保留输入和旧基准，显式刷新展示服务器最新名称/说明并更新保存基准。设置页不直接更新保留工作区的文档或 revision；工作台可在显式保存时安全合并仅样式的远端变化，具体基准/历史保护见 app-workspace 与 workspace-ui README，真实字幕竞争仍保留冲突。直接访问、登录后继续和刷新均保留目标组织/项目；不存在/无权限/归档有明确状态。策略测试：`project-data/project-style-save.test.ts`；真实数据库回归：`WorkspaceRegressionTests.test_project_styles_refresh_and_retry`。`npm run test:project-settings`、`npm run test:style-management` 使用 HTTP 测试夹具，不访问开发数据库。

本次验证及限制见 [项目设置记录](../../../docs/experiments/project-settings.md)。

本机片源恢复：ProjectForm 复用 media/VideoFilePicker，在支持的安全上下文中使用文件句柄选择器，其他环境/选择器失败时回退普通文件 input；取消保留原选择。SelectedVideo 只经创建回调与 app-workspace 显式传给播放器，不进入创建请求。句柄仅由媒体模块在播放器校验后持久化；完整职责和浏览器测试见 [media README](../media/README.md)。

项目设置另组合公开 glossary-ui/GlossarySettings：项目默认只读组织当前表，活动项目成员可显式fork当前组织词条成为项目副本，再自由添加/编辑；organizer/dev可切回组织默认，副本不合并删除。表单/分页和工作区共用 glossary-data，不导入工作区内部。术语保存及关联使用独立 token，不读取/更新本页 ProjectDetail 的字幕 revision，不提交样式或其他工作区草稿；归档只读。详见 [术语模块](../glossary-ui/README.md) 与 `npm run test:glossary`。

## 中英文展示边界（2026-11-15）

日期展示使用当前界面 locale；项目名/说明保持用户原值。错误/成功反馈保存 MessageValue，切换语言时重新格式化，不重新保存或刷新项目。设置页与创建弹窗的 key 仍只反映账号/资源归属，未保存名称、说明和文件选择不因语言变化重建。完整维护/语言验收流程见 [国际化文档](../../../docs/internationalization.md)。
