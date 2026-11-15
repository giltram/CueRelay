# 组织默认术语表与项目副本

当前规则（2026-11-13）：组织维护唯一默认术语表。项目没有显式项目表时，直接查询组织当前表；工作区与项目设置均只读组织词条。需要修改时，成员明确点击「创建项目副本」，完整 fork 当前组织词条，再维护项目副本。复制后的所有词条平等可编辑，没有新旧区分，也没有任何自动同步或回写。

## 所有权与依赖

`http_api/glossary_views → projects/glossary_services → glossary/services → organizations/accounts`。

- glossary 拥有 Glossary、Entry、字段校验、组织默认表身份、快照复制与词条 CAS。`is_organization_default` 条件唯一约束保证每组织至多一张默认表；默认身份不可更换，无重命名/删除接口。
- projects 拥有可空 FK 及独立 `glossary_version`。FK=null 表示使用组织默认，非空表示显式项目表。解析与使用计数由 projects 拥有，下层不反向读取 Project ORM。
- 组织设置也经 projects 的公开聚合服务取得计数；底层组织词条写入和复制仍仅由 glossary 服务承担。无跨模块私有 ORM、signals 或全局业务状态。
- 前端 App 组合 organization 资源插槽；account-ui 只负责设置页布局。workspace-ui / project-ui / App → glossary-ui → glossary-data → contracts/shared；页面之间无内部互导。组织维护和项目维护共用字段、表单、分页和冲突草稿。

## 默认、fork 与权限

只读组织默认表不会创建空记录；未有词条时显示「组织术语表还没有词条」。首次成功从组织设置添加时，原子创建默认表及第一条词条；并发添加汇入同一张表。默认表名称固定为「组织术语表」，所有当前和未来无显式项目表的项目自动使用。

活动项目 member/organizer/dev 都可显式 fork，不要求媒体已验证，不弹额外确认或命名表单；副本名称取当前项目名。服务在组织锁内读取组织当前表，分批500条复制全部内容，生成新表/词条 UUID、词条初始 revision=1、记录 fork 操作者/时间。原词/译名/备注完整保留，不记录来源或新旧区分。源为空时生成空项目表，不创建组织默认空表。

fork、词条复制及项目关联/version 更新在同一事务中，失败整体回滚。组织词条写入也持有同一组织锁，所以 fork 取得一致的当前快照。复制后修改原有词条、添加新词条均只影响副本；后续组织更新也不进入副本。不同项目分别 fork 后互不影响，不叠加查询组织词条。

组织内活动成员可从「设置 → 组织设置 → 组织术语表」查询、添加、编辑组织词条，沿用现有成员维护权限。项目上下文写组织词条始终被服务端拒绝，dev 也不能绕过；必须 fork 或到组织设置维护。

organizer/dev 可在项目设置点击「使用组织术语表」切回默认；只改引用，不合并/删除副本，不改字幕。原副本保留在组织中，本版不提供删除、重新选择历史副本或任意其他项目表选择器。已存在的显式项目表及其共享引用迁移后保留，绝不擅自合并入组织默认表。

归档项目可查询，插入入口禁用，不能 fork、编辑项目词条或切关联。默认项目包含归档项目，重查时看到组织最新值；已 fork 的归档项目继续读取自身副本。共享提示的 N 为实际使用数量，组织默认计数包括所有 null FK 项目和归档项目。无归档快照或多人实时推送。

## 保存与并发边界

锁顺序：User → Organization → Project（项目命令）→ Glossary → Entry。成员撤权与资源写入同组织锁串行；HTTP 继续使用 Session、CSRF 和 X-CueRelay-User，服务端独立验证身份/组织/项目/表归属/归档。

词条 CAS 使用自身 `revision`，关联使用 `association_version` + 当前有效 `glossary_id`。组织默认尚未具象时为 id=null；默认表身份永不更换，因此并发首次创建后原 null token 可继续使用，但项目关联版本必须匹配。fork 或切回默认递增关联版本，迟到的旧请求不能改到新目标；竞争 fork 仅一个成功，其余409，无孤立副本。

词条冲突为 `glossary_conflict`，关联为 `glossary_association_conflict`，项目写组织默认为 `organization_glossary_read_only`，归档为 `project_archived`（HTTP409）。冲突保留输入，只有明确「重新加载服务器内容」才替换表单。无变化词条不递增 revision。

所有术语命令不接受/返回字幕 document、media、字幕 revision。fork/切回仅 save `glossary` 和 `glossary_version` 两列；不调用 projects.touch，不改字幕文档、保存版本、项目更新时间/修改者或工作区保存基准。字幕撤销只作用于译名插入，不撤销服务器术语操作。

## HTTP

前缀 `/api/organizations/:organizationId`，全部 JSON：

| 方法/路径 | 输入/输出 |
| --- | --- |
| GET `/glossary` | search/page；返回组织默认关联信息和分页词条 |
| POST `/glossary` | association_version=1、glossary_id/null、original、translation、note；原子创建/添加组织词条 |
| GET `/glossary/:tableId/entries/:entryId` | 显式读取组织服务器词条 |
| PUT 同上 | POST字段另加 revision，编辑组织词条 |
| GET `/projects/:projectId/glossary` | search/page；返回有效表、uses_organization_default、归档和分页词条 |
| PUT 同上 | association_version、glossary_id，另择 `fork:true` 或 `use_organization_default:true` |
| POST 同上 | token及词条内容；只允许显式项目表 |
| GET `/projects/:projectId/glossary/:tableId/entries/:entryId` | 当前有效表的服务器词条 |
| PUT 同上 | token、词条内容和revision；只允许显式项目表 |

关联输出：association_version、table/null、archived、uses_organization_default。table摘要：id、name、created_at、is_organization_default、project_count。分页另含 entries、empty、total、page、has_more；entry为稳定id、原词、译名、备注、revision、updated_by.username、updated_at。写响应只带关联信息及可选entry，无字幕快照。

不再提供 `/projects/:id/glossary/tables` 或任意 target_id/name 关联接口。无 DELETE 接口。未知写字段拒绝，校验失败400，无权403，不存在404。

字段限制唯一声明于 `shared/glossary-limits.json`：原词/译名各200 Unicode码点，备注2000，表名100，搜索200。字段 trim 后必填非空，拒绝 NUL/非法 Unicode。普通文本展示，不解释 HTML/ASS。同表 trim 后原词+译名相同拒绝（大小写敏感），编辑排除自身；同原词可有不同译名。三字段字面包含查询，忽略拉丁大小写，`%`/`_`/正则按字面；原词/UUID稳定排序，每页25。

## 前端生命周期

项目侧栏与QC互斥，继续1061px宽屏并排/窄屏切换规则；无本地工作区入口，不改音视频布局。组织默认状态显示只读提示和「创建项目副本」，副本内新旧词条共用同一编辑行为。组织设置直接展示简单表格、搜索、添加和编辑，无额外知识库导航。

打开、返回页面/window focus、明确刷新、查询/翻页时获取最新数据，不随播放/字幕输入请求。普通刷新失败保留可展示数据；身份/权限失效清除数据。请求序号、API/启用代次和卸载标志隔离旧响应；账号传输复用 expectedUser。刷新不覆盖正在编辑的草稿；成功立即更新列表再刷新分页。

插入继续使用当前行UTF-16光标/选区；失焦保留、切行清除，未记录则追加。composition/权限/媒体验证/可见性通过后，按正常字幕编辑编码换行并记录单次可撤销历史，焦点回到字幕框；不保存字幕。词条输入保留原生编辑，IME Enter及工作区快捷键隔离。

## 迁移和验证

执行正常部署 `python backend/manage.py migrate`：在原 glossary.0001 / projects.0003 基础上，新增 `glossary.0002_glossary_is_organization_default_and_more`（默认标记及唯一约束）和 `projects.0004_remove_project_glossary_auto_created`（移除旧首次项目创建特例标志）。现有表均为非组织默认，既有 FK/词条ID/版本/字幕/媒体不变。空 FK 自动解析组织默认，不需要给每个项目回填关联或生成空表。

后端：`projects.test_glossary`、`projects.test_glossary_migration`；前端：Vitest/TypeScript/构建及 `npm run test:glossary`。详细最新执行结果见 [组织默认验证](experiments/organization-glossary.md)。旧首版行为验证保留在 [历史记录](experiments/glossary.md)，不能据此推断当前语义。
