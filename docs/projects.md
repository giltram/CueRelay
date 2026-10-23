# 项目面板与保存契约

状态：2026-10-23。已接入组织项目列表、原子初始化、固定权限管理、归档/恢复与手动字幕快照保存。沿用组织固定 organizer/member，dev=is_superuser；没有新项目角色或工种权限。

## 界面与流程

登录后默认进入当前组织的「项目」。进行中按 updated_at/id 倒序，过去项目按 archived_at/id 倒序；过去以明确归档为准，不按日期推断完成。列表显示名称、说明、更新/归档时间及操作者，支持名称搜索、每页 25 项分页、无组织/无项目/无结果与错误重试。

organizer 和 dev 可创建项目，只有本组织 organizer 有本组织管理权。新建先填写名称/说明，再选择固定本地视频和空字幕或导入 ASS；浏览器验证可播放首帧与 0–10 小时时长，Worker 每次读取至多 4MiB 计算完整 SHA-256，可取消且有进度。最终确认才提交创建，视频不上传，失败保留输入且无半成品记录。初始 File 通过显式内存接口交给新工作区，不保存到账号设置或服务器。

编辑信息仅接受名称/说明与 revision；发生冲突保留表单，「刷新项目版本」展示服务器最新名称/说明并保留输入，用户核对后再保存。组织和视频基准不可移动/更换。归档确认明确尚未保存内容不会自动提交；归档项目只读查看/导出，恢复后继续工作，无硬删除入口。

member 可查看本组织项目并编辑/保存字幕，不能管理项目元数据。dev 可选择所有组织，不建立虚假成员关系。所有权限在服务器逐请求判断；按钮显隐只是提示。

## 工作区和数据安全

项目列表是工作区的浏览入口：打开列表保留已经挂载的编辑器、字幕、时间草稿、选中行、File/Object URL 和视频节点，同时暂停隐藏的播放和全局快捷键。返回同一工作区不重建；打开其他项目或本地工作区、换组织/账号、主动退出及重新加载时，先提供导出、取消或明确放弃。

项目工作区初次加载数据库快照。刷新后先回到项目列表，重新打开才能读取保存后的内容；需重新选择同一视频并完成摘要核对。未匹配前可浏览字幕，修改与提交禁用；归档始终只读。保存只含已应用的字幕，未应用时间须先点击应用，界面明确说明。导出仍使用公开 /api/ass/export，会话失效也能导出本地稿。

每次手动保存提交 revision；服务器拒绝旧版本，保留客户端输入并提示重新加载。多个浏览器不会悄悄互相覆盖，也不会自动合并。App 轮询只检查归档状态，本页归档/恢复也即时同步状态；不将取得的服务器文档/revision 覆盖到编辑器；有新版本须经保护步骤显式重载。会话失效后同账号登录继续当前工作区。

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
