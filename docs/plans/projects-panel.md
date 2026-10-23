# 项目面板实施计划

日期：2026-10-23。依据本次用户确认的设计实现项目面板；保留已有账号安全未提交改动与音频实验。

1. 新增 projects 叶上业务模块：组织内项目、固定视频 SHA-256/大小/时长、初始化 ASS 快照、active/archived、操作者/时间与单调 revision。组织鉴权沿用固定 organizer/member，dev 跨组织。创建与初始字幕同事务，项目不硬删除、不跨组织移动、不换视频基准。
2. HTTP 适配复用既有 Session/CSRF/账号一致性边界。列表分页/搜索，创建、详情、管理信息修改、归档/恢复、字幕快照显式保存。写入先锁操作者账号，再锁组织和项目、重新鉴权；revision 防覆盖，归档只读。成员可编辑字幕，但不能管理项目元数据。无实时协作/自动保存/历史恢复。
3. 项目面板在 App 组合，EditorWorkbench 不包含列表/组织管理。浏览项目列表保持已挂载编辑器，切项目/账号/组织前保留现有导出/取消/放弃。为当前本地编辑器保留显式入口，不自动归属已有稿件。
4. 新建：名称/说明 → 本地视频完整分块 SHA-256 与可播放元数据 → 空字幕/合法 ASS → 最终原子创建。工作区重新选片必须核对同一摘要后才允许提交字幕；视频不上传。哈希在 Worker 中执行、可取消有进度，避免整视频读入内存。
5. 真实 PostgreSQL 权限/事务/冲突/归档测试、前端纯逻辑与浏览器流程、文档和运行服务验证。

架构：application → http_api → projects → {organizations, accounts, ass_format}；organizations/accounts/ass_format 不反向依赖 projects。前端 App → project-ui/workspace-ui，project-data 拥有 DTO/API，media 的文件摘要不依赖账号或 UI。

完成状态：上述五步已实现。真实 PostgreSQL 后端 57 项、前端 91 项、类型检查/构建、项目与既有账号浏览器流程均通过；边界和限制见 ../projects.md、../experiments/projects.md。本机开发库已应用增量迁移，前后端保留运行供手工验证。
