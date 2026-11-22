# projects

## 组织member权限（2026-11-22）

业务服务在组织锁内按create/edit/archive/restore_project、edit_subtitles、manage_project_styles及术语具体能力鉴权。普通保存不能改source/styles/script；样式命令检查输入cue差异和输出cue差异，均须字幕权限，assign只属字幕权限。原子创建只需创建能力；归档/CAS/来源/媒体不变量保持。项目GET返回当前操作者effective_permissions供保留工作区观察。参见 [完整权限契约](../../docs/member-permissions.md)，覆盖下文首版固定角色描述。


拥有组织内项目生命周期及显式保存的 ASS 文档快照。公开入口在 services.py：organization_for、read_project、create_project、update_project、set_archived、save_document。ProjectConflict 表示 revision 冲突或归档只读。HTTP 适配在 ../http_api/project_views.py。

SRT 初始化由上游 `srt_format` 先转换为同一 v2 文档及完整 ASS source，创建仍只接受现有 source 契约；本模块不依赖 SRT parser、不新增格式字段/保存路径。已有项目的 source/styles/script 仍不可由普通字幕保存替换；只读 SRT 导出不触及项目/revision。持久化与拒绝替换回归见 test_srt.py，格式规则见相邻 srt_format/README.md。

依赖：organizations 的 Organization/require_access、accounts 的 User 外键、ass_format 的纯格式入口、Django。底层模块不反向依赖 projects；没有 signals 或实时广播；固定业务权限契约归 organizations。

## 数据与不变量

Project 保存组织、名称/说明、active/archived、固定 media JSON、document JSON、revision、创建/更新/归档操作者与时间。媒体仅包含完整 sha256、字节数、duration_ms，不保存文件名、路径、File 或媒体字节。document 为现有有限 ASS DTO 的完整快照；沿用原始模板、受支持语义与大小边界，文档契约为 v2，样式是带 UUID 的快照值对象，Cue 通过 style_id 引用。

- organizer/dev 固定拥有业务能力；dev 无需成员关系。member 业务能力按本组织配置，默认可保存字幕、不能管理元数据或归档/恢复。
- 新建在最终确认时原子保存媒体和已预检的 ASS；没有半成品/草稿项目记录。
- 写入先锁操作者 User，再锁 Organization、重新检查活动身份和组织关系，最后锁 Project；与成员撤权串行。不会在组织锁之后反向获取 User 行锁；操作者锁也覆盖创建/更新/归档外键检查。
- 修改、保存、归档和恢复都要求当前 revision，变化后加一；无变化不改 revision/时间。旧版本返回 409，不能覆盖新状态。归档拒绝名称/字幕修改，恢复后才可写。
- 组织、媒体基准、ASS 原始模板不可替换；样式/脚本只通过 style_services.change_styles 的具名操作更新，普通 save_document 拒绝偷改定义/来源。无项目删除入口，Admin 未注册写入口。维护脚本必须使用公开 services。
- 当前是手动保存的整文档快照，没有 cue_version、project_seq、ChangeEvent、审核、历史恢复或实时租约；不要把 revision 描述为事件流序号。

所有请求由 Session 确认身份，CSRF/账号一致性头复用 HTTP 既有边界。文件摘要是防误选机制，不能证明恶意客户端加载了何种文件，也不是服务端权限凭证。

## 验证

migrations/0001_initial.py 增量建表，保留既有数据。tests.py 使用 PostgreSQL 验证权限、原子初始化、有限 ASS、归档约束、分页/搜索、并发保存及归档竞争。

## 快照拆分

`split_cue` 是新增公开命令：接受 revision、完整本地 document、cue_id、mode、position，在锁外调用 ass_format.split_document 验证，再调用现有 save_document。没有第二条持久化路径；一次事务替换完整快照并加一次 revision。HTTP POST /split 返回新 document、两条身份及 project 摘要；不接受客户端指定结果 UUID。并发拆分/保存/删除/归档由相同 revision 校验串行化，失败不产生部分行。

按用户确认不扩展为实时协作：没有字幕版本/租约/审核/历史/推送；其他窗口需重新读取快照。拆分会同时保存发送的其他本地编辑与当前时间草稿，网络响应丢失后需重载确认。详见 [编辑操作契约](../../docs/editing-operations.md)，数据库测试在 test_splitting.py。

## 样式命令（A 阶段）

公开 `style_services.change_styles(actor, organization_id, project_id, revision, document, operation)`：锁操作者 User → Organization → Project，重查活动成员/归档/revision，验证传入 source/styles/script 等于权威基准，应用纯格式操作，最后用既有 touch 一次持久化完整结果。包括客户端已应用的字幕编辑，不包含独立时间草稿；失败/no-op 不递增 revision。普通保存和拆分仍不允许修改定义、UUID 或来源字段，避免跨项目引用与来源伪造。

项目样式、字幕行分配及组织模板三个写操作分别检查对应业务权限；默认行为与原角色规则一致。import 通过 organizations.style_templates.template_snapshot 公开读取同组织、指定 revision 的快照，并生成新的项目 UUID；项目不访问模板私有模型。模板删除不级联影响任何快照。

创建项目可原子接受 script 和 style_imports；现有项目通过 `import_many`（非空 imports 数组，至多 1000 项）一次导入多个模板，旧 `import` 单模板操作继续兼容。两者复用 document_styles.import_templates 的版本/组织检查与批量快照转换，只做一次最终格式验证，不对每个模板重复序列化整份文档。现有项目整批只 touch 一次，revision 加一；任何模板冲突、重名、适配错误均不持久化部分结果，创建失败不留下项目。

迁移 projects.0002 将旧 JSON 文档转为 v2，保留 source/Cue ID/source_id/media/revision/操作者/时间；遇到异常文档整体回滚，报告项目 ID。不可逆，回滚依赖部署前备份。部署步骤及 API 见 [样式管理契约](../../docs/style-management.md)。权限/事务/多连接并发在 test_styles.py，既有数据迁移在 test_style_migration.py。

维护入口 `python manage.py check_style_migration [--database default]` 只读扫描全部快照，调用同一个 `ass_format.migration.upgrade_legacy_document` 验证 v1，验证已升级 v2 时调用 serialize_ass；逐项报告不兼容项目 ID/原因并非零退出，不更改 source、名称或 UUID。无需先应用 projects.0002，亦不触发迁移。历史严格拒绝夹具与真实迁移事务回滚见 `ass_format/fixtures/legacy-v1/` 和 `test_style_migration.py`；测试从空测试库撤销数据迁移的应用记录以建立 v1 状态，再执行真实迁移，不对不可逆迁移编造降级函数。

本阶段没有 WS、不可变修改历史或审核对象，仅记录现有最近修改者/时间并保护冲突。按已确认方案 A，其他成员显式重载才接受新样式；不要把 JASSUB 本地实时预览描述为多人实时同步。

## 术语表关联

`glossary_services.py` 拥有项目上下文解析、关联/CAS、使用计数及组织设置聚合，不访问 glossary 私有 ORM；下层只通过公开服务管理默认身份、词条和快照复制。Project.glossary=null 表示动态使用组织默认表，非空为显式项目表；glossary_version 独立于字幕 revision。

默认组织表在项目上下文严格只读，只能在组织设置维护。活动项目有fork_project_glossary能力者可「创建项目副本」：User → Organization → Project 锁下调用 fork_organization_table，当前组织词条按快照全部复制（新ID/revision1），再原子更新 FK/version。副本新旧词条无区别、自由编辑；与源没有任何后续同步/回写。组织写入同组织锁串行，竞争fork仅一个成功、失败不留下空副本。

有use_organization_glossary能力者可明确切回默认，旧副本保留、不合并/删除；不再有任意表选择/空白新建接口。归档上下文只读不可fork/切换。默认使用计数包括所有空FK项目及归档项目，旧显式共享引用仍保留。

关联只save glossary/glossary_version两列，不touch字幕document/revision/media/updated_at/updated_by，不让维护操作接纳远端字幕保存基准。词条自身另有revision。新增 glossary.0002 标识组织唯一默认表，projects.0004 移除旧auto_created特例；旧FK/词条ID/保存边界不变，不合并已有表。测试 test_glossary.py / test_glossary_migration.py 覆盖真实数据库竞争、权限、双向隔离、失败回滚及迁移后继续保存。详见 [当前契约](../../docs/glossary.md)。

## 中英文展示边界（2026-11-15）

校验/冲突信息附带稳定 reason/params；HTTP 保留原 code/message/status 并把具体错误交给展示层。语言偏好不参与项目 revision、文档快照、保存重试、术语关联或媒体基准。完整维护/语言验收流程见 [国际化文档](../../docs/internationalization.md)。
