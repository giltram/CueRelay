# 领域模型与工作流

状态：推荐设计基线，非 Django Model 定稿。硬约束集中在 [不变量](invariants.md)；传输与失败语义见 [实时协议](realtime-protocol.md)。

## 1. 聚合边界与实体职责

当前已实现身份、组织和项目快照边界；后续章节中的实时协作、行级持久化、审核、租约与历史事件均未实现。项目当前承担固定时间基准、ASS 模板和显式保存的整文档快照，完整契约见 [projects](projects.md)。P0 每项目一个视频基准、一份共享 ASS 文档。以下是业务概念，不表示每个概念都必须独立建表。

| 概念 | 职责、关键数据与生命周期 |
| --- | --- |
| User（已实现） | accounts.User(AbstractUser)，username 用于登录和显示，标准密码摘要，is_active；dev=is_superuser，is_staff 仅表示 Admin 资格；停用代替删除 |
| Organization（已实现） | name、created_at；dev 在 Admin 原子创建组织和初始活动 organizer |
| OrganizationMembership（已实现） | 唯一 (organization,user)，role 仅 organizer/member；同账号多组织不同角色；组织至少一名活动 organizer |
| PersonalSettings（已实现） | 与 User 一对一，快捷键覆盖和更新时间；账号共用，无 organization_id，无记录则使用共享默认配置 |
| Project（快照切片已实现） | 组织、名称/说明、active/archived、不可变媒体基准、有限 ASS document JSON、revision、创建/更新/归档时间和操作者；显式保存、归档只读、可恢复，不硬删除。project_seq/style_revision/租约仍为未来设计 |
| 项目访问（已实现） | 继承组织关系；member 查看并保存活动项目字幕，organizer 管理本组织元数据与生命周期，dev 管理所有组织；无 ProjectMembership 或工种权限集合 |
| MediaManifest | Project 内的值对象：完整 SHA-256、文件大小、时间原点约定和必要时长/分辨率；时长等是诊断信息。首次发布后不可替换，不保存路径或媒体字节 |
| OrganizationStyleTemplate（已实现） | 组织模板表：名称/ASS 字段/参考 PlayRes/来源说明/revision/操作者；organizer/dev 管理，同组织复制导入后无动态继承 |
| ProjectStyle（快照值对象已实现） | Project.document v2 内稳定 UUID、唯一名称、完整 ASS 字段、原始锚点与可选模板来源快照；Cue.style_id 引用。允许改名，禁止删除被 Dialogue/Comment 使用的样式与最后一个样式；无单独 ORM 表 |
| SubtitleCue | 稳定 ID、项目、开始/结束、原始 ASS 文本、样式 ID、Layer/Name/Margins 等已知字段、事件顺序、`cue_version`、`submitted_version`、软删除标记；空轴→草稿→提交→审核，可反复修改 |
| Review | 不可变审核决定：批准/要求修改、审核者、时间、可选理由、绑定版本元组；不保存成一个可随意覆盖的 `approved` 布尔值 |
| EditLease | 一行一个有效排他租约；服务端编辑会话、用户、不可猜测 token、过期时间。申请/续期/释放/撤销；不是修改历史，不以 Redis 为权威 |
| ChangeEvent | 一个成功持久命令对应一个项目序号，记录操作者、命令 ID、服务器时间、受影响 ID、前后值/版本及因果关系；状态与日志同事务提交，不用于重建全部数据库 |
| CommandReceipt | 成功命令的幂等回执：项目/用户/命令 ID、请求指纹、结果、可选项目序号；有变更时可与 ChangeEvent 同记录存储，no-op 仍需独立可查询的成功回执，不必另建通用命令框架 |
| AssDocumentSource | 成功导入时保留原始字节、编码/解析报告、已知注释/元数据与事件顺序；限定大小的字幕文本附件，不是视频存储；失败预检不持久化项目数据，原件继续留在用户本地 |
| Comment（P1） | 用户行评论；与 ASS `Comment:` 事件不同。绑定稳定行 ID 和上下文版本；行删除后保留在历史，拆分/合并不擅自搬移 |

```mermaid
erDiagram
    User ||--o{ OrganizationMembership : joins
    Organization ||--|{ OrganizationMembership : authorizes
    User ||--o| PersonalSettings : configures
    Organization ||--o{ Project : owns
    Organization ||--o{ OrganizationStyleTemplate : stores
    Project ||--o{ ProjectStyle : defines
    Project ||--o{ SubtitleCue : contains
    ProjectStyle ||--o{ SubtitleCue : styles
    SubtitleCue ||--o{ Review : records
    SubtitleCue ||--o| EditLease : leases
    Project ||--o{ ChangeEvent : orders
    Project ||--o| AssDocumentSource : preserves
```

MediaManifest、CommandReceipt 和未来 Comment 未全部画作独立表；外键布局在实现时再确定。Review/ChangeEvent 不因软删除而级联消失。ASS 注释事件不参与翻译、审核队列，但保留自身字段和事件次序。

## 2. 时间、标识与版本

当前快照实现使用 revision：元数据/字幕/归档/恢复发生变化时单调加一，无变化不变；写入带当前版本，旧版本 409，不自动合并。Organization → Project 行锁下重新鉴权。下面 project_seq、cue_version、审核和历史规则为未来完整协作设计，不表示已有实现。

- 项目创建是初始化事务：已认证创建者提交本地计算的媒体基准，服务器原子建立 Project、届时确认的创建者访问关系、默认样式及 seq=1 的创建事件/回执，style_revision 初始为 1；中途失败不暴露半个项目。之后所有项目操作遵循同一 Project 锁规则。
- 时间是相对同一媒体时间原点的非负整数毫秒；P0 持久值须为 10ms 的整数倍，对应 ASS 百分秒。界面捕获播放位置时明确吸附到此网格，若产生零长度则拒绝，不能悄悄拉长。`start < end`；允许行间重叠。超过报告时长先警告，不基于可能不准确的元数据截断内容。
- 行 ID 永不复用，显示行号不是 ID。时间列表按 `(start,end,event_order,id)` 排序；导出使用独立稳定的 `event_order` 保持 ASS 重叠/碰撞顺序，不能用界面时间排序擅自重排行文件。
- `cue_version` 从 1 起；每次真正改变行字段、显式提交、删除/恢复加一。无变化保存是 no-op，不增加版本。审核决定自身不改 cue_version，而是追加 Review 和 ChangeEvent。
- `submitted_version` 仅在显式提交时设为新 cue_version。任一后续行编辑使二者不等，自动回到草稿；不再额外存储容易漂移的“翻译已完成”布尔字段。
- `style_revision` 是项目全套样式和影响渲染的脚本设置版本；修改任一样式/这些设置递增一次。仅使旧样式版本的视觉 QC 失效，不使内容审核或翻译提交失效，也不逐行批量改版本。
- `project_seq` 对所有持久项目变更连续递增：行、审核、样式、成员、归档、导入、显式管理员撤锁审计等。一次导入或未来拆并影响多对象，也只占一个序号。失败/no-op/普通租约申请续期释放及过期/在线心跳不增加序号。序号是传输游标，不是所有行的编辑前置条件。

## 3. 当前固定权限方案 A

| 身份 | 能力 |
| --- | --- |
| dev（User.is_superuser） | 站点管理；Admin 建号/停用/重置密码和创建组织；管理全部组织，不要求假成员关系 |
| organizer（OrganizationMembership.role） | 仅本组织：查看、修改组织名、添加已有活动账号、调整固定角色、移除成员、退出 |
| member（OrganizationMembership.role） | 查看本组织和成员、退出本组织；不按翻译/打轴/校对工种划分 |

组织角色不放在 User 或 Django Group。organizer 不能授予 dev、改站点管理字段、停用账号或管理其他组织。个人设置只属于本人账号；所有组织写入重查活动身份及目标组织权限，不能信任前端组织选择。

降级、移除、退出和关联账号停用均必须在组织行锁下保留至少一名活动 organizer；完整锁顺序、Admin 边界与 API 契约见 [user-system](user-system.md)。组织模板管理已归 organizer/dev；项目 member/organizer/dev 可编辑样式，未新增项目级权限矩阵。独立本地工作区仍无云端组织归属；显式创建的项目属于其组织，切组织不会上传或转移已有本地字幕。后续审核/租约章节只描述未来数据流，不改变本切片的固定角色决定。

## 4. 提交与视觉 QC 的派生状态（未来设计）

当前尚无审核实体；本节状态机描述未来视觉 QC。内容审核须单独绑定对应内容版本并保留，样式变化不清除内容审核事实。有效视觉 QC 绑定 `(cue_id, cue_version, style_revision, media_sha256)`。服务器在同一事务中检查这些值仍是当前值、行未删除且当前翻译已提交，再记录决定。批准和要求修改都需要显式操作，不能由自动保存推断。

```mermaid
stateDiagram-v2
    [*] --> Draft: 创建空轴或导入
    Draft --> Ready: 保存有效非空译文并显式提交
    Ready --> Approved: 当前版本批准
    Ready --> NeedsChanges: 当前版本要求修改
    Approved --> NeedsChanges: 当前版本追加要求修改
    NeedsChanges --> Approved: 当前版本追加批准
    Ready --> Draft: 行字段改变
    Approved --> Draft: 行字段改变
    NeedsChanges --> Draft: 行字段改变
    NeedsChanges --> Ready: 显式重新提交生成新版本
    Approved --> Ready: 样式或渲染设置改变
    NeedsChanges --> Ready: 样式或渲染设置改变
    Draft --> Deleted: 删除
    Ready --> Deleted: 删除
    Approved --> Deleted: 删除
    NeedsChanges --> Deleted: 删除
    Deleted --> Draft: P1 显式恢复成新版本
```

状态由以下优先规则计算，不同时存储这些状态字段：

1. 已软删除：Deleted，不出现在活动队列/导出。
2. 译文不满足可提交条件，或 `submitted_version != cue_version`：Draft。
3. 无当前绑定元组的 Review：Ready。
4. 当前绑定元组的最后一个决定为 approved/changes_requested：Approved/NeedsChanges。

可提交条件包括合法时间、有效项目样式、受支持的 ASS 语法和至少一个可显示非空白字符；不能只剥掉大括号后误判含绘图的行。无修改但要求重新提交时，显式 submit 仍生成新版本和历史；普通重复保存不会冒充重新提交。同一版本重复审核通过预期的 review-head ID 防止覆盖未知决定，详见协议。

内容或时间改变后历史 Review 原样保留，只是不再有效。样式改动不撤销翻译提交或内容审核；仅视觉 QC 回到 Ready 而非 Draft。P0 基准视频不能更换。相邻行改变不会自动改变本行状态；审核界面保留当时 project_seq 供上下文追查，但它不是整个项目的批准证明。

## 5. 日常流转与结构性操作

打轴创建空轴后立即让出该行；翻译在停输后保存，并在完成一行时提交、释放锁；校对取锁后通看上下文，决定或先修改。校对修改会使旧提交失效，必须重新提交才可批准。可提供一次按钮组合多个明确步骤，但服务端语义必须原子或逐步显示，不能显示中途已审核。

删除必须确认当前 cue_version 和租约；已批准行也可按权限删除，但必须留痕。持有旧版本的客户端收到删除后保留本地草稿为冲突材料，不自动复活行。

| 操作 | 计划语义 |
| --- | --- |
| 拆分（P1） | 一事务锁定源行及项目；软删除源行，生成新 ID 的两个 Draft；显式选时间切点与文本分配，不能猜测翻译切分；样式/允许元数据继承，审核不继承 |
| 合并（P1） | 确认所有源行当前版本及租约；一个事务软删除源行、生成新 Draft；明确时间区间、文本连接、样式选择，冲突字段由用户确认 |
| 评论/来源关联（P1） | 原行历史保留；新行记录 `derived_from`，界面可追溯来源；旧评论不伪装成针对新文本的审核，需人工重新关联 |
| 历史恢复（P1） | 将选定历史内容作为当前新版本写入，正常鉴权/取锁/比版本、追加日志；不回拨 project_seq/cue_version，不复活旧审核，不覆盖后来其他行修改 |

当前只设计这些后续规则，不在 P0 暗中增加拆并命令或通用事件重放框架。P0 历史只读，故障恢复依赖数据库备份和管理员调查。

## 6. ASS 可编辑契约与保护策略

这是产品承诺的兼容性边界，不等于底层渲染器宣称能显示的全部功能。

| 内容 | P0 计划 |
| --- | --- |
| 文件 | UTF-8（可含 BOM）的 ASS v4+；按文件 `Format:` 映射字段，Text 内逗号不得被错误拆分；导出 UTF-8、明确换行与小数点格式 |
| 样式/脚本设置 | 支持标准 v4+ 样式字段、PlayResX/Y、WrapStyle、ScaledBorderAndShadow、YCbCr Matrix；有效值与默认值需有样例测试；样式名唯一，引用必须能解析 |
| Dialogue | 时间、Text、Style 可编辑；Layer、Name、MarginL/R/V 等已知字段保留，P0 只读；非空 Effect 进入保护性路径 |
| 文本 | 普通中文/Unicode，`\N` 强制换行、`\n` 软换行、`\h` 空格及 `\b0/1`、`\i0/1`、`\u0/1`、`\s0/1`；支持组合标签块，准确保留语义，不转换成 HTML |
| 注释/元数据 | 已知 `Comment:` 事件、分号注释、Script Info 非执行性键值保留并维持锚点/顺序；路径/URL 只作文本，绝不自动读取/请求 |
| 保护性内容 | 未知 section/字段/tag、SSA 旧格式、绘图/卡拉 OK/动画、局部字体/颜色/位置覆写、附件 Fonts/Graphics、错误语法/编码、无法安全分类的记录：整份文件不进入可编辑导入 |

导入分“预检→报告→管理员确认→原子提交”，只允许空项目，预检记录绑定原始文件摘要和预期 project_seq/style_revision。报告列出文件/行号/原因，不悄悄删除标签、映射缺失样式或导入半份文件。支持的注释字段也要验证其结构；未知标签出现在注释中同样走保护性路径，避免绕过导出边界。

保护性路径只允许原始文本检查、兼容性报告与从本地选中 File 重新下载原件，不持久化被拒文件，也不承诺可视预览；不能通过一次“继续”破坏内容后伪装为保真导入。预检文件可通过有界请求在服务器解析，失败后不保存副本；成功导入时才将 AssDocumentSource 和业务数据一同提交，后续原件下载走成员授权。用户若另行简化文件，应保留原件并作为新输入重新预检。解析器选型必须经过 [S3](milestones.md)，不能假设第三方对象模型天然保留所有未知数据。

“保真”分两种：原件下载须字节相同；受支持子集的编辑导出须语义等价并保留规定的非编辑数据，但不承诺空白、BOM、格式化逐字节一致。导出必须从单一项目快照生成，不能混入不同时间的样式和行。Text 新增不支持标签也必须在保存时拒绝；有能力渲染复杂 ASS 不意味着有能力安全编辑它。
