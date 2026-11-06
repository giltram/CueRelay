# 使用手册

`handbook.md` 是手册正文的唯一来源，直接编辑 Markdown 即可。`HandbookPage.tsx` 只负责页面壳、目录跳转和展示预编译内容，不存正文或另一份目录。

## 内容维护与构建

- 普通段落、列表、粗体、行内代码、引用和 Markdown 表格均可直接使用。二级标题写为 `## 标题 {#stable-id}`，标题自动进入目录；保留现有稳定锚点，新增章节使用不重复的小写英文/数字/连字符 ID。
- 快捷键表格直接使用标准 Markdown，包含表头、分隔行及完整键位，在 MarkText 等编辑器和网站中均可阅读，不使用构建占位符。`build/handbook-markdown.test.ts` 核对表中所有可配置动作与根 `shared/timing-shortcuts.json` 的默认键位；修改默认键位时同步更新正文，个人覆盖仍以个人设置为准。
- `frontend/build/handbook-plugin.ts` 在 Vite 开发转换和生产构建阶段调用 `handbook-markdown.ts`，用构建依赖 Marked 生成介绍和章节的 HTML 字符串，导出普通 JS 模块。生产包不包含 Markdown 解析器，不单独请求 `.md`，不增加后端接口。
- 页面只展示仓库构建生成的可信 HTML，不接受用户/网络提供的 Markdown。编译器拒绝原始 HTML，允许普通注释；缺少/重复锚点会使构建失败。`content.ts` 是唯一编译输出契约，`markdown.d.ts` 提供导入类型。
- 修改手册后重新构建、部署前端即可生效；开发服务器会更新 Markdown 模块。无需迁移数据库，不重置账号首次提示状态。Marked 的 [编译 API](https://marked.js.org/using_pro) 仅在构建阶段使用。

目录普通点击只滚动正文，不新增路由/fragment 历史条目，避免干扰 HistoryNavigation 的页面前进/回退；锚点 href 保留复制和原生新标签页能力。

依赖方向：`App → handbook-ui → {navigation, page-ui, 预编译手册, React}`；构建侧 `Vite → build/handbook-plugin → build/handbook-markdown → {Marked, handbook-ui/content 类型契约}`。页面不导入构建工具，工作区、账号数据层不依赖手册。App 注入页头及 navigate；navigation 唯一拥有 `/handbook` 和带组织上下文的地址，沿用登录深链接及新标签页规则。首次提示由 account-ui/HandbookPrompt 展示，账号确认由 accounts 持有。

正文维护点：打轴练习、频谱和波形差异、焦点与输入、时间草稿/提交/保存、默认快捷键、Aegisub 迁移、多人版本冲突、项目拆分保存例外、样式和 ASS 限制。产品操作或默认键变化时同步检查正文。当前不提供搜索、步骤向导、已读进度或版本弹窗。

回归：build/handbook-markdown.test.ts 覆盖正文/标准 Markdown 表格编译、快捷键完整性与共享默认一致性和编译失败约束；navigation/routes.test.ts；browser-tests/handbook.mjs（Chrome，隔离 HTTP fixture，不写开发数据库）。用生产预览服务运行 `HANDBOOK_PRODUCTION=1 npm run test:handbook`，额外检查没有 `.md` 网络请求。
