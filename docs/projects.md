# 项目面板与保存契约

状态：2026-10-24。已接入组织项目列表、原子初始化、固定权限管理、归档/恢复与手动字幕快照保存。沿用组织固定 organizer/member，dev=is_superuser；没有新项目角色或工种权限。

## 界面与流程

登录后默认进入当前组织的「项目」。进行中按 updated_at/id 倒序，过去项目按 archived_at/id 倒序；过去以明确归档为准，不按日期推断完成。列表显示名称、说明、更新/归档时间及操作者，支持名称搜索、每页 25 项分页、无组织/无项目/无结果与错误重试。

organizer 和 dev 可创建项目，只有本组织 organizer 有本组织管理权。「新建项目」在当前列表页打开弹窗，不改 URL 或新增标签页。名称、说明、固定本地视频及空字幕/导入 ASS 在同一表单填写，不设中间步骤；浏览器验证可播放首帧与 0–10 小时时长，Worker 每次读取至多 4MiB 计算完整 SHA-256，可取消且有进度。最终确认才提交创建，视频不上传，失败保留输入且无半成品记录。初始 File 在同一标签页内通过显式内存接口交给随后显示的工作区，不保存到账号设置或服务器。

项目列表操作直接显示「项目设置」和「归档项目」，过去项目直接显示「恢复项目」，不折叠；通过项目名称进入工作区，不再显示打开/只读查看按钮。「项目设置」在新标签页打开 `/organizations/:organizationId/projects/:projectId/settings`，可编辑名称和说明，保存后留在设置页；仅接受名称/说明与 revision；发生冲突保留表单，「刷新项目版本」展示服务器最新名称/说明并保留输入，用户核对后再保存。组织和视频基准不可移动/更换。归档确认明确尚未保存内容不会自动提交；归档项目只读查看/导出，恢复后继续工作，无硬删除入口。

member 可查看本组织项目并编辑/保存字幕，不能管理项目元数据。dev 可选择所有组织，不建立虚假成员关系。所有权限在服务器逐请求判断；按钮显隐只是提示。

## 工作区和数据安全

项目 URL 为 `/organizations/:organizationId/projects/:projectId/workspace`，组织列表为 `/organizations/:organizationId/projects`，本地工作区为 `/workspace/local`，从组织列表新开时使用 `/organizations/:organizationId/workspace/local` 延续组织上下文；入口 `/` 和 `/projects` 仅在没有显式资源目标时选择默认组织。登录保持原请求 URL，成功后继续指定项目。项目名称与项目设置均为真实链接，普通点击默认新开标签页，继续支持中键、Ctrl/Cmd 和复制地址。

左上角 CueRelay 是首页链接，点击在当前标签页进入 `/`，展示当前可访问组织的项目列表并保留根地址；不清空已有工作区。无组织时展示列表空状态和本地工作区入口。

工作区的「项目列表」默认在新标签页打开项目所属组织列表，本地工作区使用当前组织、无组织使用 `/projects`；原页面不隐藏、卸载或主动暂停视频。浏览器将标签页置于后台可能自行节流，应用不承诺操作系统的播放调度。

同标签页通过历史导航浏览同组织列表或设置页时，保留已经挂载的编辑器、字幕、时间草稿、选中行、File/Object URL 和视频节点，同时暂停隐藏的播放和全局快捷键。返回同一工作区不重建；打开其他项目或本地工作区、换组织/账号、主动退出及重新加载时，先提供导出、取消或明确放弃。新建前先处理当前文档保留的旧稿；确认后在列表打开表单。创建成功使用返回的详情及原 File，push 新项目地址，回退返回原列表；明确取消仅关闭弹窗。导航取消恢复原 URL 和页面，单纯浏览列表不要求放弃。

项目工作区初次、直接访问或整页刷新时，按 URL 加载指定组织和项目的数据库快照，不能回退到默认组织或列表。新标签页/刷新拥有独立工作区，需重新选择同一视频并完成摘要核对。无权限、不存在及失败有明确状态、返回列表和重试入口；归档在原地址只读打开。未匹配前可浏览字幕，修改与提交禁用；归档始终只读。保存只含已应用的字幕，未提交时间须先按提交快捷键提交，界面明确说明。导出仍使用公开 /api/ass/export，会话失效也能导出本地稿。

每次手动保存提交 revision；服务器拒绝旧版本，保留客户端输入并提示重新加载。多个浏览器不会悄悄互相覆盖，也不会自动合并。app-workspace 轮询观察归档/访问权限状态，本页归档/恢复也即时同步状态；不将取得的服务器文档/revision 覆盖到编辑器；有新版本须经保护步骤显式重载。会话失效后同账号登录继续当前工作区。

「本地工作区」仍是独立工具，无云端项目归属；现有稿件不自动绑定新项目。它的字幕仍仅在内存，用户自行导出。

## 数据和 API

projects.Project 单表保存组织、name（100 字符）、description（2000 字符）、status、media、document、revision、创建/更新/归档操作者和时间。media 只包含 sha256/size/duration_ms。document 使用现有有限 ASS DTO；保存经同一个 ass_format 序列化器验证，源模板和样式定义不能替换。数据库约束限制状态、正 revision 和归档时间/操作者一致性。

| 方法与路径（前缀 /api/organizations/{org_id}/projects） | 输入/职责 |
| --- | --- |
| GET 根路径 | status=active/archived、search、page；返回 projects、total、page、has_more，不包含媒体/字幕快照 |
| POST 根路径 | name、description、media、source（空字幕用 null）；原子初始化 |
| GET /{project_id} | 受保护详情，含媒体和字幕 |
| PATCH /{project_id} | name、description、revision |
| POST /{project_id}/archive | revision |
| POST /{project_id}/restore | revision |
| PUT /{project_id}/document | document、revision；活动组织成员可保存字幕 |

Session/CSRF、账号变更头、no-store、错误格式复用既有 HTTP 边界。400 无效输入、401 未认证、403 越权、404 不存在或项目不属于 URL 组织、409 project_conflict/project_archived、422 invalid_ass。列表只允许白名单参数，所有写入严格字段白名单。

写入锁顺序操作者 User → Organization → Project；持有组织锁后重新鉴权，与成员撤权/账号停用的组织锁协调，不会在组织锁之后再锁 User。项目模块只向下依赖 organizations/accounts/ass_format，不把项目操作放进用户模型或媒体模块。

## 运行与限制

应用增量迁移 `python manage.py migrate`，前端 `npm ci` 安装新增的 @noble/hashes 2.0.1（MIT）；既有音频依赖及实现保留。后台未注册 Project 写入口，项目管理使用面板/API，维护脚本调用 projects.services。

这是项目快照切片，不实现自动保存、实时协作、行锁、历史事件/恢复、组织样式库、媒体上传或更换基准。SHA-256 是浏览器防误选能力，无法证明恶意客户端实际播放了什么。大型真实片源性能、多浏览器及生产部署仍需验收。

测试命令见根 README。浏览器测试使用新建的 cuerelay_projects_browser 数据库，设置 PGDATABASE、DEBUG=1、BROWSER_TEST_PASSWORD 后执行 migrate 和 `python backend/manage.py shell < backend/browser_tests/seed_projects.py`；启动该库的后端及 Vite，运行 `BROWSER_TEST_PASSWORD=... node frontend/browser-tests/projects.mjs`，可用 PROJECTS_URL 指定地址（默认 5177）。播种拒绝已有账号数据库，测试输出截图目录。实际结果见 [验收记录](experiments/projects.md)。

前端路由/保留实例的职责分别见 [navigation](../frontend/src/navigation/README.md) 与 [app-workspace](../frontend/src/app-workspace/README.md)。深路径部署及导航回归运行方式见 [前端部署](frontend-deployment.md)。URL 和 history 不保存正文、视频或草稿，不新增持久化或跨标签页同步。

项目列表右上角的「设置」进入个人/组织设置独立页面，路径和职责见 [账号界面](../frontend/src/account-ui/README.md)。已移除「返回工作区」入口；默认点击同项目链接仍新开独立工作区；只有同文档浏览器前进/回退恢复保留实例。组织切换器仅在项目列表，工作区和设置页不保留。

视频和字幕选片取消不关闭创建弹窗，也不清除名称、说明或已校验的文件；Modal 区分文件 input 冒泡的 cancel 与 dialog 自身取消。具体回归与限制见 [单页创建记录](experiments/project-form.md)。旧创建地址 `/organizations/:organizationId/projects/new` 规范到对应列表。

## 样式管理升级

样式不再是名称数组：Project.document 使用 schema_version=2 的结构化样式与脚本设置，Cue.style_id 指向本项目 UUID。项目样式管理沿用当前 member 可编辑能力及整文档 revision；操作会保存当前已应用字幕，时间草稿保持独立。组织模板只能 organizer/dev 管理，创建项目和已有项目都可复制导入。模板来源 UUID/revision 仅用于追踪。ASS 初始 source 仍不可替换。

需应用 organizations.0002 与 projects.0002 并同步升级客户端；维护窗口先导出页面稿件和备份数据库。旧页面与 v1 写入明确拒绝。详细 API、适配边界与验证见 [样式管理契约](style-management.md)。
