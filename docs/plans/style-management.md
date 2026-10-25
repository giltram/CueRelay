# Organization Style Library / Project Style Manager

日期：2026-10-24。状态：用户已选择 A，并授权文档 v2 / 模板表迁移；样式切片已实现，协作与完整历史延后。最终契约与执行结果见 [style-management](../style-management.md)。

## 现状与依据

- `projects.Project.document` 是唯一持久字幕快照，`revision` 保护整个项目；没有独立的 ProjectStyle / SubtitleCue 表。
- `ass_format` 公开 DTO 为 `{source, styles: string[], cues}`，Cue.style 是名称；定义、PlayRes 和 Comment 都在原始 source 中。codec 使用原始行号保留 Dialogue 身份与辅助字段，不能通过导出后重新解析来更新正在编辑的文档。
- `projects.services.save_document` 明确禁止替换 source 和 styles。这是已有保护契约，不能简单删除校验而允许任意 source 替换。
- 写入复用 User → Organization → Project 锁顺序、事务内重鉴权、归档保护、revision CAS；member 可保存字幕，organizer/dev 管理项目元数据。
- `ass-preview` 已通过同一个后端序列化器与 JASSUB 实现实时视频预览；有同源 Noto Sans SC fallback、字体替代提示，不查询或上传系统字体。
- `application/asgi.py` 只有 Django ASGI；没有 Channels、Redis 接入、collaboration 模块、ChangeEvent、CommandReceipt、Review、租约或事件重放。设计文档中对应章节是未来基线。
- `docs/domain-model.md` 的未来规则禁止修改已引用的样式名；本任务要求允许改名。实现时须同步更新该规则，保留稳定 ID 引用。
- 工作树已有未提交的 ASS 预览及相关前端改动；本任务保留这些修改，只在必要集成处增量修改。

主要入口：`backend/ass_format/README.md`、`backend/projects/README.md`、`backend/organizations/README.md`、`frontend/src/contracts/subtitles.ts`、`frontend/src/app-workspace/README.md`、`frontend/src/ass-preview/README.md`、`docs/realtime-protocol.md`。

## 已确认的数据与接口迁移

### 最小数据布局

1. OrganizationStyleTemplate 放在 organizations 边界，新增模板表；包含组织、稳定 UUID、名称、受支持的 ASS 字段、参考 PlayRes、revision、创建/更新者与时间。不另建 Django app 或权限框架。
2. ProjectStyle 继续作为 Project.document 内的值对象，包含稳定 UUID、项目内唯一名称、ASS 字段及可选的来源模板 ID / 导入时模板 revision。来源由服务器记录，模板删除不会删除副本。
3. 文档升级为明确的 schema v2：结构化 styles、脚本设置和 cue.style_id。Cue ID、source_id、事件顺序和固定媒体基准不变。不同时维护可写的 cue.style 与 style_id。
4. 保留 source 作为受支持元数据与事件锚点模板。渲染/导出的样式与脚本设置只取结构化当前值；通过 codec 按 Format 映射覆盖对应字段，不靠改写 source 再导入生成新 Cue ID。
5. 项目样式第一阶段沿用整文档显式保存与 project.revision，不引入第二套样式版本流；模板使用自身 revision。暂不建立独立的 ProjectStyle / SubtitleCue ORM 表。

采用快照值对象可避免在本功能中重建字幕持久化；代价是不同字幕和样式编辑仍可能因整项目 revision 冲突，需人工处理，不能承诺行级并发合并。

### 增量部署与兼容

- 新增 organizations schema migration 和 projects 数据迁移，将既有文档一次性转换为 v2，生成并持久化项目内样式 UUID；不按名称重新生成 ID。
- 数据迁移保留 source、Cue 身份、source_id、辅助事件数据和媒体。先完整验证再写入；遇到异常文档中止迁移并报告项目 ID，不跳过或丢弃。
- 为每份迁移文档验证 v1/v2 导出的支持子集语义等价，包含 Comment 和重排 Format。
- 原子导入生成新的项目样式身份；复制项目/跨项目导入同样生成新身份。普通保存只接受所属项目当前样式集合中的引用；新增、复制、删除与来源字段由具名样式操作校验，不能将客户端 UUID 当成授权证明。
- HTTP 路径尽量不变，但 import/empty/export/split、项目创建/加载/保存的 document 契约受影响；旧客户端必须明确收到升级错误，不能猜测兼容并静默重映射名称。
- 发布前备份数据库，维护窗口暂停项目写入，迁移并同步部署前后端；旧打开页面停止写入并提示先导出本地草稿、刷新。迁移后的功能数据无法无损映射回旧版名称数组，回滚使用部署前备份与显式恢复流程，不做自动破坏性降级。

### 依赖边界与权限

- `ass_format` 新增聚焦的样式字段验证、适配和序列化逻辑；仍不依赖 ORM、HTTP 或 React。
- `organizations` 模板服务可向下依赖 ass_format 的公开纯函数；不依赖 projects。模板 CRUD 限 organizer/dev，读取限当前组织成员/dev，所有版本检查在组织锁下进行。
- `projects` 复用 organizations 的公开模板查询契约完成同组织 copy-on-import，不跨模块访问模板私有模型。项目写入继续走既有锁与 revision 路径。
- 项目样式编辑建议沿用现有字幕编辑能力（活动 member/organizer/dev）；归档只读。若需要仅 organizer 编辑项目样式，须在实施前单独确认，不能通过前端按钮隐藏替代后端鉴权。
- `http_api` 只做请求适配。`contracts` 与 `project-data` 更新显式类型/API；`workspace-ui` 组合样式面板，业务转换不放在 React 组件内。
- 文档保存、样式操作及待保存字幕必须明确使用同一工作区快照和 revision；样式操作不能悄悄推进 savedRevision，让旧字幕绕过 CAS。UI 明示哪些本地变更随操作保存，失败保留全部草稿。

## 增量实施与验证

1. **格式契约与迁移**：先补稳定 ID、名称/字段验证、schema 版本和迁移测试，再改 ASS 序列化。保留原始 Dialogue 锚点、Comment 样式引用、分号注释和辅助字段；改名同步导出引用，使用数包含受保护 Comment。禁止删除被 Dialogue 或 Comment 引用的样式及最后一个样式。
2. **模板与项目操作**：模板 CRUD、同组织快照导入、项目 CRUD、独立复制、按 ID 批量分配 Cue、按字段白名单批量编辑。批量编辑预检全部目标后一次事务写入；重复/不存在 ID、重名、非法字段、归档、权限和版本失败均整批拒绝。颜色等未选属性不被覆盖。
3. **管理界面与预览**：组织设置内模板库；工作区内项目样式管理面板，复用现有 Modal/表单风格。支持搜索、使用数、单选/多选、复制、颜色与效果预览、明确选字段的批量表单；新建项目表单可选模板，创建事务原子导入。预览走现有 serialize → JASSUB，不新增 ASS 渲染器。所有样式变更进入现有未保存保护。
4. **分辨率适配**：提供原样复制和受限等比适配。仅在源/目标 PlayRes 都明确、宽高比相同且边框缩放设置明确兼容时开放等比适配；对字号、字距、边距和可缩放描边/阴影使用统一比例，整数边距规定一致舍入规则。颜色/透明度、布尔、百分比 ScaleX/Y、角度、对齐、Encoding 不缩放。宽高比改变、缺少/重复/非法 PlayRes、边框缩放设置不兼容时保留复制选项并提示人工调整，不推断视频像素。具体数值范围、舍入规则及边界用样例固定后再开放此选项。
5. **协作与历史基础设施**：见下一节范围选择；不能将显式重载或本地实时视频预览宣称为多人实时同步。
6. **整体审查**：更新 architecture/domain-model/invariants、模块 README、API/升级文档和验证记录；检查依赖无环、服务端字段白名单、权限重查和唯一数据所有权。

## 已确认的协作范围：A

任务要求复用已有 WS/历史体系，但当前只有设计。用户已确认 A；B 仅保留为未采用的备选，不属于本阶段范围。不能用样式专属轮询、日志或事件总线替代公共设施。

- **A：先完成样式切片，再实施公共协作基础设施（建议）**。先交付上述 1–4、6，保留 revision 冲突保护和显式重载；模板和项目记录最近操作者/时间。完整不可变历史、在线成员主动接收更新、重放与相应验收明确待第 5 阶段，不能把此切片报告为原任务全部完成。
- **B：先建设已设计的公共协作/历史基础设施，再完成样式切片**。需扩展 projects 的通用 ChangeEvent/CommandReceipt、连续序号、一致快照/重放、HTTP 命令及客户端恢复、collaboration/Channels/Redis 部署与逐次鉴权，再接入样式。这会影响现有所有项目写入口和部署，需另写公共设施执行方案与 ADR；不得只给样式开一条平行传输/审计路径。

当前无翻译提交/审核实体，不新增假审核状态。更新领域约束时明确：样式与渲染设置变更要求视觉 QC 重新检查，保留内容翻译提交及内容审核事实；未来 Review 的既有版本元组须按内容/视觉责任重新明确，不能直接声称已实现区分。

## 测试矩阵与已执行基线

- 纯格式：标准字段及透明度、字段重排、中文/逗号、语义往返、改名与 Comment、稳定 ID、删除/跨项目引用拒绝、受限 PlayRes 转换、保护性拒绝不支持内容。
- PostgreSQL 服务/API：模板创建编辑/删除、copy-on-import 隔离、独立复制、批量字段保留、回滚故障注入、归档、跨组织/项目、无权限、模板/项目旧版本，以及独立连接并发写入只能一方成功。
- 前端：多选/搜索/使用数、未选字段保留、草稿/时间/选中状态保护、失败/冲突不覆盖、模板创建项目、字体替代提示、样式修改后同一 JASSUB 实例更新预览；浏览器回归包含旧编辑操作和现有本地媒体隐私边界。
- 协作阶段另验证协议乱序/重复/尾事件丢失、断线补齐、事务提交后推送失败、撤权、并发/未知结果恢复；未实现前不声称任务验收 14 通过。
- 2026-10-24 已执行：`DJANGO_SECRET_KEY=style-plan-baseline .venv/bin/python backend/manage.py test ass_format http_api.tests --verbosity 1`：21 项通过，Django system check 无问题（无数据库用例）。
- 2026-10-24 已执行：`cd frontend && npm run test -- --run`：25 个测试文件、255 项通过。
- 本阶段未执行数据库集成测试、浏览器验收或迁移；尚无功能代码变更。

## 实施结果

已完成阶段 1–4、6：保留项目 JSON 快照与原始 ASS 锚点，新增组织模板表、v2 数据迁移、具名样式命令、管理 UI、JASSUB 样本预览及测试。具体执行命令/结果与限制以 [样式管理契约](../style-management.md) 为准。本文前面的现状与基线保留为实施前记录，不表示当前功能仍缺失。
