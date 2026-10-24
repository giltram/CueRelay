# projects

拥有组织内项目生命周期及显式保存的 ASS 文档快照。公开入口在 services.py：organization_for、read_project、create_project、update_project、set_archived、save_document。ProjectConflict 表示 revision 冲突或归档只读。HTTP 适配在 ../http_api/project_views.py。

依赖：organizations 的 Organization/require_access、accounts 的 User 外键、ass_format 的纯格式入口、Django。底层模块不反向依赖 projects；没有 signals、实时广播或独立权限矩阵。

## 数据与不变量

Project 保存组织、名称/说明、active/archived、固定 media JSON、document JSON、revision、创建/更新/归档操作者与时间。媒体仅包含完整 sha256、字节数、duration_ms，不保存文件名、路径、File 或媒体字节。document 为现有有限 ASS DTO 的完整快照；沿用原始模板、受支持语义与大小边界。

- organizer 管理本组织项目，dev 管理所有组织，无需成员关系。member 可查看并显式保存活动项目的字幕，不能修改名称/说明或归档/恢复。
- 新建在最终确认时原子保存媒体和已预检的 ASS；没有半成品/草稿项目记录。
- 写入先锁操作者 User，再锁 Organization、重新检查活动身份和组织关系，最后锁 Project；与成员撤权串行。不会在组织锁之后反向获取 User 行锁；操作者锁也覆盖创建/更新/归档外键检查。
- 修改、保存、归档和恢复都要求当前 revision，变化后加一；无变化不改 revision/时间。旧版本返回 409，不能覆盖新状态。归档拒绝名称/字幕修改，恢复后才可写。
- 组织、媒体基准、ASS 原始模板/样式定义不可经更新接口替换。无项目删除入口，Admin 未注册写入口。维护脚本必须使用公开 services。
- 当前是手动保存的整文档快照，没有 cue_version、project_seq、ChangeEvent、审核、历史恢复或实时租约；不要把 revision 描述为事件流序号。

所有请求由 Session 确认身份，CSRF/账号一致性头复用 HTTP 既有边界。文件摘要是防误选机制，不能证明恶意客户端加载了何种文件，也不是服务端权限凭证。

## 验证

migrations/0001_initial.py 增量建表，保留既有数据。tests.py 使用 PostgreSQL 验证权限、原子初始化、有限 ASS、归档约束、分页/搜索、并发保存及归档竞争。

## 快照拆分

`split_cue` 是新增公开命令：接受 revision、完整本地 document、cue_id、mode、position，在锁外调用 ass_format.split_document 验证，再调用现有 save_document。没有第二条持久化路径；一次事务替换完整快照并加一次 revision。HTTP POST /split 返回新 document、两条身份及 project 摘要；不接受客户端指定结果 UUID。并发拆分/保存/删除/归档由相同 revision 校验串行化，失败不产生部分行。

按用户确认不扩展为实时协作：没有字幕版本/租约/审核/历史/推送；其他窗口需重新读取快照。拆分会同时保存发送的其他本地编辑与当前时间草稿，网络响应丢失后需重载确认。详见 [编辑操作契约](../../docs/editing-operations.md)，数据库测试在 test_splitting.py。
