# 样式界面

拥有组织模板、项目样式管理的展示/表单与临时效果预览投影，不拥有第二份可写字幕文档。服务端验证、ID 生成、ASS 适配、持久事务不在 React 组件中实现。

- `ProjectStyleManager` 接收当前文档、上层已排序的 cueRows、当前行、编辑能力及 onApply；表单输入只是未应用草稿。成功后上层一次接纳服务端完整文档/版本，失败保留输入。项目管理器由 ProjectSettingsPage 组合，使用已保存字幕快照，无需视频，不提交工作区未保存的内容；已打开的工作区显式重载后才接受新样式。本地管理器仍由 EditorWorkbench 组合，需要导出。列表选择用于批量属性编辑，字幕选择独立用于批量分配。
- `OrganizationStyleLibrary` 接收组织/管理能力/JsonRequest，读写仅经 templateApi。App 通过 SettingsPage 的 ReactNode 插槽组合库，account-ui 不反向依赖 style-ui。库可以预检 ASS 并提取一个样式为模板，来源说明是可编辑文本；模板 revision 在表单打开时冻结，冲突需取消、点击列表「刷新」并重新核对。「刷新」用于主动取得其他成员或标签页的更新，本页增删改后自动刷新。工具栏按钮与搜索输入框底部对齐；编辑弹窗仅保留底部取消/保存，Escape 仍可取消。组织列表不展示易被误认成选择框的颜色色块，效果预览在编辑弹窗中查看；项目管理器的真实多选框仍用于批量操作。
- `TemplateImportSelection` 选择模板 ID/revision、新名称与 copy/scale；主动刷新清除选择，避免悄悄接纳另一模板版本。项目创建与现有项目均可一次导入多个；现有项目发送一条 `import_many` 操作，整批成功后清空选择并选中最后导入的样式，失败保留选择、名称与适配方式。
- `StyleFieldsEditor` 展示标准 ASS 字段，批量只提交明确勾选字段。`style-fields.ts` 仅负责字段标签、ABGR/RGB 显示、批量载荷投影和临时样本文档，不实现样式验证/几何转换。
- `StyleSamplePreview` 属于 ass-preview，复用 JASSUB 与正式序列化器。样本投影永不写回编辑器或触发保存状态；错误显示在预览区域。

直接依赖 contracts、project-data、account-ui 的既有 Modal 和 ass-preview。无 workspace-ui/project-ui 内部导入；本地工作区/项目设置/项目表单/App 向下组合本模块。样式 CSS 使用既有变量，窄屏在现有 Modal 内滚动。

验证：style-fields.test.ts、browser-tests/style-management.mjs；服务端矩阵及完整限制见 [样式契约](../../../docs/style-management.md)。
