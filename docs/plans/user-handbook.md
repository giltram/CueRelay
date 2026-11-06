# 首次使用提示与手册

2026-11-06。范围：账号首次使用提示、独立 `/handbook` 页面、个人设置入口。不增加导览步骤或改变字幕编辑流程。

- accounts.User.handbook_seen 拥有账号级已确认状态，默认 false；升级只将 last_login 非空的旧账号标记为 true，尚未登录的旧账号仍提示。
- `/api/me/settings` 只读返回 handbook_seen，原 PATCH 字段不变；`POST /api/me/handbook` 以空 JSON 幂等确认，只更新当前账号，经既有 Session/CSRF/账号一致性检查。
- App 组合首次 Modal、暂停工作区快捷键；关闭或点击手册链接立即收起，并异步确认。失败只在页头提示，下次进入可重试，不阻塞用户；旧账号代次的响应不改新账号。确认不依赖浏览器 Storage，不改工作区实例。
- navigation 唯一拥有 `/handbook` 和带组织上下文的 `/organizations/:id/handbook`；链接默认新标签页。handbook-ui 只负责静态内容及页面样式，不依赖工作区内部。
- 内容以仓库当前实现为准：打轴练习、试听/焦点、时间草稿与保存、Aegisub 迁移速查、样式、ASS 边界和版本冲突。默认键从共享声明读取，明确个人覆盖优先。

验证：路由单测、HTTP 身份/幂等/隔离/CSRF、历史账号迁移、Chrome 首次提示/关闭/打开新页/刷新/设置入口/失败重试/深链接/窄屏、类型检查与构建。执行结果见 `docs/experiments/user-handbook.md`。

2026-11-07 用户确认正文拆为 Markdown，构建期打包：handbook.md 唯一维护正文与章节标题；构建插件预编译为普通 JS 数据，解析器仅为开发依赖；保留共享快捷键生成表格，不新增运行时请求/后端接口。页面展示边界只接受仓库构建产物。补充编译契约测试和生产预览浏览器回归，验证文案/锚点/表格不变且无 Markdown 请求。
