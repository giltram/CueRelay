# 项目面板

ProjectsPanel 负责组织项目列表（进行中/过去、搜索、分页、管理入口）；ProjectForm 负责名称/说明与媒体/ASS 初始化、编辑和冲突后的显式版本刷新。App 拥有当前组织、项目工作区和切换保护，面板不读取 EditorWorkbench 内部状态。

公开输入是 Organization、contracts/http.JsonRequest、打开/本地工作区回调。所有 HTTP 契约封装在 project-data/projects-api.ts，DTO 在 contracts/projects.ts。media/media-manifest.ts 只负责本地媒体元数据与 Worker 完整 SHA-256，不依赖 UI/账号。

浏览列表保持 EditorWorkbench 挂载，但隐藏并暂停其播放和全局快捷键；重新打开同一项目恢复当前快照，切项目/组织/账号或重新加载先走导出/取消/明确放弃。App 的同账号会话刷新不会替换文档或接纳新的保存 revision。

归档只读；保存冲突保留字幕和时间草稿，重新加载需要明确放弃。项目保存仅包含已应用字幕，不含未应用时间、File 或视频；没有自动保存。文件完整匹配后才允许修改字幕。初始模板/样式只能在创建时选择，项目工作区不提供替换 ASS 导入。

验证：media/file-hash.test.ts、frontend/browser-tests/projects.mjs。浏览器播种脚本 backend/browser_tests/seed_projects.py 只接受新建的 cuerelay_projects_browser 数据库。
