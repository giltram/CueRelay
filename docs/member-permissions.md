# 组织 member 业务权限

2026-11-22：每个组织保存一套权限，适用于该组织全部 member。没有逐成员/逐项目覆盖、自定义角色或通用 RBAC。dev 仍为 `is_superuser`，跨组织且不需要成员关系；organizer 固定拥有本组织全部业务能力。`can_manage` 仅表示原有成员/角色及权限配置管理能力，不能用于放行业务操作。

## 权威契约

唯一合法 key 与默认值在 `shared/member-permissions.json`。`organizations/permissions.py` 拥有纯配置校验/default merge；`organizations/services.py` 公开 `effective_permissions`、`require_permission`、`read_permissions`、`save_permissions`。业务服务向下依赖这些接口，不将 member 当成 organizer。所有现有成员及最后活动 organizer 保护保持原样。

| key | member 能力 | 默认 |
| --- | --- | --- |
| create_project | 原子创建项目，包括字幕/样式/脚本/媒体初始化 | 禁止 |
| edit_project | 修改项目名称、说明与参考字幕 | 禁止 |
| archive_project | 归档项目 | 禁止 |
| restore_project | 恢复项目 | 禁止 |
| edit_subtitles | 字幕正文、时间、行样式分配、行操作及保存 | 允许 |
| manage_project_styles | 项目样式定义及脚本设置 | 允许 |
| fork_project_glossary | 创建组织默认术语表的项目副本 | 允许 |
| edit_project_glossary | 添加/修改项目副本词条 | 允许 |
| use_organization_glossary | 切回组织默认术语表 | 禁止 |
| edit_organization_glossary | 在组织设置添加/修改组织词条 | 允许 |
| create_style_template | 新建/提取/另存为组织样式模板 | 禁止 |
| edit_style_template | 修改组织样式模板 | 禁止 |
| delete_style_template | 删除组织样式模板 | 禁止 |
| rename_organization | 修改组织名 | 禁止 |

组织基础浏览、个人设置、退出、本机稿件导出无开关。添加/移除成员、角色升降、organizer 管理和最后活动 organizer 规则不进入此配置，即使 member 全开也不能取得这些能力或读取配置资源。站点管理/创建组织仍仅 dev。无新增项目删除/术语删除/审核/历史/实时协作业务。

`organizations.0003` 只增加 `Organization.member_permissions`（JSON 默认 `{}`）及 `permissions_revision`（初始1）。空覆盖合并上述固定默认，不修改项目/字幕/成员/术语数据。新旧组织默认行为一致。维护写入必须经过服务；Admin 表单仍只暴露原有字段，不能直接改 JSON。

## HTTP

- `GET /api/organizations/{id}/member-permissions`：仅 dev/本组织 organizer，返回 `{permissions: 全部14项boolean, revision: 正整数}`。
- 同地址 `PUT`：同样身份限制，提交同一结构，全量替换；拒绝未知/缺少key、非严格boolean、非法revision和外层未知字段。相同配置不升版；版本不符返回 `409 permissions_conflict`，不覆盖服务器或当前表单草稿。
- 组织列表/详情及项目详情（含创建、元数据更新响应）额外返回 `effective_permissions`，只表示当前操作者能力，不暴露可编辑配置及其revision。普通 member 读取配置资源返回403。

所有接口继续使用 Session/CSRF、账号一致性头、no-store 和既有中英文错误契约。配置写入和业务写入均先锁操作者 User，再锁 Organization，再锁项目/模板/术语资源；组织锁内重读活动身份、关系及权限，撤权与写入串行。成员变更沿用目标 User → Organization 原规则，无组织锁后新增用户锁。

## 文档写入与只读不变量

普通 `save_document`/拆分需要 `edit_subtitles`，仍只可修改 cues，source/styles/script 必须等于锁内权威文档。项目样式命令继续校验整个输入快照的 source/styles/script；输入 cues 不同须字幕权限。定义/脚本/导入命令需要样式权限；`assign` 是字幕行操作，只需要字幕权限。命令输出如改变 cues 也再次校验字幕权限。仅样式能力不能夹带正文/时间/行分配变化，仅字幕能力不能替换定义/脚本/来源。所有路径复用原revision/CAS和格式验证，无旁路保存。

创建能力只授权一次原子初始化，后续编辑分别鉴权。归档只读、媒体/ASS源固定、跨组织隔离、模板快照复制、项目上下文组织默认术语表只读及独立术语版本仍有效。

## 前端与观察

组织设置 `MemberPermissionsPanel` 只对 `can_manage` 展示，三组14个原生复选框、明确保存；冲突保留选择，明确「重新加载权限配置」才采用当前配置。其他设置操作使用各自有效权限，成员管理继续只用原 `can_manage`。

工作区项目GET的权限和归档状态一起通过既有 ReadOrder 接纳，沿用focus/visibilitychange/30秒读取。旧成功不能覆盖较新撤权；显式reload被较新相同revision/status确认时也采用较新的权限。只更新保留实例的权限，不更换document/revision、选中行、历史、未保存时间输入或媒体。字幕关闭后仍可浏览、导出，独立授权的术语fork/维护仍可操作；恢复后继续原实例。组织级页面沿用 App 的组织读取顺序。没有WS或新增全局权限缓存。

## 验证

- `organizations.test_permissions`：14项真实HTTP默认/拒绝/单项授权矩阵，配置CAS/合法值/隔离/身份边界，混合快照与归档/版本保护，真实PostgreSQL竞争。
- `organizations.test_permission_migration`：实际回退schema后重新应用新增字段迁移，验证既有项目/媒体/成员和默认行为保留。
- `frontend/src/contracts/permissions.test.ts`：独立开关与兼容回退。
- `browser_tests.regression.WorkspaceRegressionTests.test_member_permission_settings`：真实浏览器双设置页冲突、14项中英文、成员可用入口与身份边界。
- `test_member_permission_business_controls`：模板创建/修改/删除入口与项目定义、字幕分配独立能力。
- `test_member_permission_workspace`：真实撤权/恢复、乱序响应、保留稿件/媒体/历史/导出和独立术语维护。

实际执行结果与环境限制见 [实施记录](plans/member-permissions.md)。

项目参考字幕创建随 create_project 原子初始化；后续上传/更换/清除需 edit_project，无需创建者身份或 edit_subtitles。所有有项目访问权的成员可读取参考，归档只读。权限 key/默认值/CAS 不变。
