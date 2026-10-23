# 账号界面

App 编排会话、组织上下文、弹窗及工作区所有权。App 显式创建并传递 account-ui/api.ts 客户端实例；实例负责同源 Session 请求、当前 CSRF Cookie、结构化错误、账号一致性头和旧上下文响应过滤，通过显式回调通知会话失效，不使用模块级账号全局状态。LoginForm、MembersPanel、PersonalPanel 只通过公开 HTTP 契约操作数据，不访问 EditorWorkbench 内部状态。

Modal 使用原生 dialog 的焦点约束和焦点恢复。App 通过 shortcutsPaused 暂停工作区快捷键，通过 WorkbenchHandle.hasContent/exportDraft 处理切换前的本地稿件。普通会话检查或同账号重新登录不能重建工作区。

默认键位来自根 shared/timing-shortcuts.json。设置只存动作覆盖，空列表禁用，删除键恢复全部默认别名。校验回归在 shortcuts-validation.test.ts 和 workspace-ui/timing-shortcuts.test.ts；完整交互验证在 frontend/browser-tests/user-system.mjs。
