# 术语数据边界

`api.ts` 将注入的 JsonRequest 适配到独立组织/项目术语资源（projectId缺省为组织上下文）；只使用 contracts/glossary 和 contracts/http，不读字幕、媒体、路由或 UI。`rules.ts` 读取 shared/glossary-limits.json 做纯校验；Unicode 按码点计数，与后端一致。`use-glossary.ts` 拥有当前查询、页码、数据、请求序号及资源写入状态；依赖 React，不依赖调用方。

打开/重新挂载、搜索/翻页、返回可见页面、window focus 及显式刷新读取最新资源，无播放或字幕输入触发请求，无 WebSocket/后台轮询。刷新失败保留已有数据；身份/权限/不存在失效清除数据。请求序号、启用代次、API 身份和卸载标志隔离迟到查询/写入响应；账号传输额外复用应用 X-CueRelay-User 和 expectedUser 保护。

写入时锁住重复提交并使旧查询失效，成功只接纳术语资源信息，随后读取当前查询；切表重置页码。没有字幕 document/revision/保存基准。表单草稿不归此 hook 管理，因此后台更新不会改掉输入。调用方通过实例 key/启用状态声明账号、项目及可见性边界。

公开消费：glossary-ui。测试：rules.test.ts、browser-tests/glossary.mjs（含真实 App 项目/账号切换及撤权迟到响应）。

项目关联仅有 fork / use_organization_default 两个命令；不提供任意表选择或隐式组织回写。服务端返回明确 uses_organization_default，UI据此只允许项目副本编辑。组织表在组织API维护，词条ID和revision校验与项目表共用。

## 中英文展示边界（2026-11-15）

validateEntry 返回 MessageValue（成功为空字符串），含字段 label descriptor 和具体限制参数；useGlossary 保留原始 Error/descriptor，不依赖 i18n。由 glossary-ui 在当前语言渲染，避免把旧语言错误字符串存入数据状态。完整维护/语言验收流程见 [国际化文档](../../../docs/internationalization.md)。
