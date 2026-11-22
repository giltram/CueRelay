# 术语界面

## member权限（2026-11-22）

OrganizationGlossary.editable、GlossaryPanel.editable/canFork和GlossarySettings.editable/canFork/canUseOrganizationDefault分别由调用方传入组织编辑、项目编辑、fork及切回的有效能力。store.enabled只表示账号/可见性/访问状态，不与字幕readOnly混用。权限关闭保留已打开词条草稿但禁用保存；字幕关闭不禁用另行授权的词条维护。见 [成员权限](../../../docs/member-permissions.md)。


公开组合：OrganizationGlossary 为组织设置维护，GlossaryPanel 为工作区侧栏，GlossarySettings 为项目设置。仅依赖 glossary-data/contracts/React 和既有主题，不导入 account-ui/workspace-ui/project-ui/navigation。App 向 SettingsPage 的 organizationGlossary 插槽组合组织组件，设置布局不读取术语内部。

GlossaryBrowser 共用分页搜索、状态、表格/列表、单个 EntryForm、冲突草稿和显式服务器重载。普通 React 文本、独立label/id、IME Enter与data-glossary快捷键隔离；表单普通输入，不进入字幕历史。刷新/失败保留输入和数据，身份/权限失效不展示旧数据。

项目默认只查询组织表，只有 uses_organization_default=false 才允许词条编辑。ProjectGlossaryActions 在活动项目按fork_project_glossary提供「创建项目副本」：一次明确操作，复制当前组织表，无命名/确认弹窗；所有复制/新增词条相同维护方式。副本不接收组织更新，也不回写组织表。项目设置内有use_organization_glossary能力者可「使用组织术语表」切回默认，旧副本不合并/删除。无任意表选择器、空白新建、来源标记或同步配置。

OrganizationGlossary 在组织设置直接提供搜索/添加/编辑表格，成员维护权限由edit_organization_glossary控制（默认允许），组织默认身份固定；不增加知识库首页。组织默认和旧显式共享表的计数包括归档项目，统一共享提示文案。

工作区仍复用QC的1061px容器断点和同一侧栏；不改上方音视频。无媒体可查询/fork，但插入遵守原canEdit。归档只读、不能fork/切换。关闭面板结束未保存表单；隐藏停止请求、返回重取，账号/项目旧响应隔离。无自动字幕保存或新全局快捷键。

浏览器：npm run test:glossary（组织维护、默认只读、fork快照、双向隔离、归档、插入/历史/布局/迟到响应）。接口与保存边界见 [术语契约](../../../docs/glossary.md)。

## 中英文展示边界（2026-11-15）

文案由本模块翻译资源展示，错误保留结构化原因并在渲染时格式化。组织默认表的固定标题可翻译，但存储的表名/用户词条不改写；项目副本和用户内容按原值显示。语言变化不改 association token、分页、表单草稿或字幕历史。完整维护/语言验收流程见 [国际化文档](../../../docs/internationalization.md)。
