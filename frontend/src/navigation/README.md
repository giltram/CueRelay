# 页面路由与历史导航

`routes.ts` 唯一拥有页面路径的解析和生成，不依赖账号、HTTP 或工作区。ID 为正安全整数，规范路径不带尾斜杠。`/` 为首页，展示当前可访问组织的项目列表并保持根地址；`/projects` 为默认组织/无组织入口，有组织时规范到组织列表地址。显式组织和项目 URL 不能被默认选择覆盖。列表筛选不进入 URL。

| 路径 | Route |
| --- | --- |
| `/` | entry，首页项目列表 |
| `/projects` | projects，无显式组织 |
| `/organizations/:organizationId/projects` | projects |
| `/organizations/:organizationId/projects/:projectId/workspace` | project |
| `/workspace/local` | local，无显式组织 |
| `/organizations/:organizationId/workspace/local` | local，携带列表组织上下文 |
| `/organizations/:organizationId/projects/new` | 旧地址，规范到该组织项目列表 |
| `/settings` | settings，无显式组织的个人设置 |
| `/organizations/:organizationId/settings/personal` | settings，携带列表组织上下文的个人设置 |
| `/organizations/:organizationId/settings/organization` | organization-settings，组织设置 |
| `/organizations/:organizationId/settings` | 旧地址，规范到该组织的 `/settings/organization` |
| 其他 | not-found |

`HistoryNavigation` 每个文档一个实例，由 `useNavigation` 管理订阅生命周期。应用通过 `NavigationRequest(route, commit)` 决定是否执行 commit；导航模块不读取 WorkbenchHandle、不拥有保护弹窗，不加载资源。重复当前地址替换条目，普通导航新增条目，入口规范化使用 replace。

popstate 无法取消：控制器先按 group/index 恢复已提交条目，再请求应用确认；允许后重放原历史跨度，取消不调用 commit。恢复与重放事件不再次提交保护流程。过期回调不能改变新条目。文档外导航由浏览器及 beforeunload 处理。history.state 只有 `cueRelayNavigation: {group, index}`，不含文档、File、账号、播放位置或草稿；整页刷新复用原条目的导航标记，但工作区内容仍从服务器加载。

`RouteLink` 渲染真实 href，默认 `target="_blank" rel="noopener noreferrer"`，常规页面入口由浏览器新开标签页。HomeLink、设置页内个人/组织分类切换和错误状态的返回列表/选择组织显式传 `target="_self"`，留在当前标签页。只有当前标签页导航才拦截没有修饰键、没有 download、目标为当前标签页的普通左键点击。新标签页、中键、右键复制等使用浏览器原生行为。项目 UI 通过此接口导航，不拼路径。`RouteStatus` 展示项目加载/权限/不存在/失败和页面不存在状态，不执行数据请求。

链接外观使用 styles.css 的主题色；项目名称保持文字链接，导航/操作入口显式加 `.button-link` 复用按钮尺寸、悬停和焦点样式，当前导航通过 aria-current 显示。外观不改变 a 元素的链接语义。

`HomeLink` 统一登录、列表、工作区及错误页的 CueRelay 标题链接，目标固定为 `/`；保留标题字体和颜色。工作区通过 title 插槽接收链接，不直接依赖导航。回首页仅浏览列表，不清空保留实例，同文档的浏览器历史可以继续当前草稿；默认点击项目链接在新标签页加载独立快照；列表已移除「返回工作区」按钮。

App 负责资源切换保护和登录后的目标继续，app-workspace 负责加载。禁止让路由 key 决定 EditorWorkbench 的挂载生命周期。单元测试：routes/history-navigation；原生行为与历史保护：browser-tests/navigation.mjs。

routeOrganization 统一识别项目、设置和本地工作区的显式组织上下文，因此新开页面不会静默选回默认组织。组织 ID 只表示页面上下文，不给本地工作区增加项目归属。组织选择控件仅存在于 `/` 和项目列表；设置、工作区及错误状态不提供切换器。深链接登录继续原路由。直接输入/同文档历史仍由 App 共用切换保护。

「新建项目」是当前列表页的操作按钮，不是页面导航；经 App 的旧工作区保护后打开 ProjectsPanel / ProjectForm 弹窗，不改 URL、不新增 tab。名称、说明、视频和字幕在同一表单填写；成功后同一文档 adoptCreated 并 push 项目工作区，保证回退回原列表。取消创建只关闭弹窗。旧 `/organizations/:organizationId/projects/new` 地址规范到组织列表，不再拥有创建路由或独立页面。无需 window.open、跨窗口传 File、Storage 或同步机制。默认行为回归在 tab-navigation.mjs；历史/旧稿保护回归使用 link-navigation.sameTab 显式覆盖 target，与默认新标签页测试分开。
