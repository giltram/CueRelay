# 项目面板

ProjectsPanel 负责组织项目列表（进行中/过去、搜索、分页、管理入口）；ProjectForm 负责名称/说明与媒体/ASS 初始化、编辑和冲突后的显式版本刷新。App 拥有当前组织和切换保护，app-workspace 拥有单个保留工作区，面板不读取 EditorWorkbench 内部状态。

公开输入是 Organization、contracts/http.JsonRequest、navigate、创建前保护/创建成功和生命周期回调。项目名称、打开/只读查看、本地工作区使用 navigation.RouteLink 的真实 href；路径解析/生成不属于面板。所有 HTTP 契约封装在 project-data/projects-api.ts，DTO 在 contracts/projects.ts。media/media-manifest.ts 只负责本地媒体元数据与 Worker 完整 SHA-256，不依赖 UI/账号。

浏览列表保持 EditorWorkbench 挂载，但隐藏并暂停其播放和全局快捷键；重新打开同一项目恢复当前快照，切项目/组织/账号或重新加载先走导出/取消/明确放弃。App 的同账号会话刷新不会替换文档或接纳新的保存 revision。

归档只读；保存冲突保留字幕和时间草稿，重新加载需要明确放弃。项目保存仅包含已应用字幕，不含未应用时间、File 或视频；没有自动保存。文件完整匹配后才允许修改字幕。初始模板/样式只能在创建时选择，项目工作区不提供替换 ASS 导入。

验证：media/file-hash.test.ts、frontend/browser-tests/projects.mjs。浏览器播种脚本 backend/browser_tests/seed_projects.py 只接受新建的 cuerelay_projects_browser 数据库。

音频时间轴只接收已接受的同一 File 和只读字幕/草稿。边界点击只修改草稿，个人提交快捷键统一提交并下一行；项目保存仍只含已提交时间。新增固定删行组合键和边界回调遵守同一 canEdit/弹窗暂停保护。跨模块回归见 `frontend/browser-tests/main-audio-integration.mjs`。

工作区列表链接默认新开标签页；同页历史返回列表才隐藏现有编辑器。新建按钮先经 App 的旧工作区保护，确认后开启表单；成功显式传递 ProjectDetail 和原 File，不放 history state。登录/直达/刷新继续指定项目和错误状态由 App/app-workspace/navigation 组合处理。回归入口新增 browser-tests/navigation.mjs。

项目列表的更新者和归档者直接显示 username，与 Session/成员身份一致，不存在显示名字段或名称回退。
