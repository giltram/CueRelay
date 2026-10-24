# 账号界面

App 编排会话、组织上下文、登录/保护弹窗及工作区所有权。App 显式创建并传递 account-ui/api.ts 客户端实例；实例负责同源 Session 请求、当前 CSRF Cookie、结构化错误、账号一致性头和旧上下文响应过滤，通过显式回调通知会话失效，不使用模块级账号全局状态。LoginForm、MembersPanel、PersonalPanel 只通过公开 HTTP 契约操作数据，不访问 EditorWorkbench 内部状态。

Modal 使用原生 dialog 的焦点约束和焦点恢复。onCancel 只响应弹窗自身（event.target === event.currentTarget），忽略文件 input 冒泡的 cancel，避免取消选片关闭整个表单；真正的 Escape 仍经 onClose 关闭，未提供 onClose 时阻止默认关闭。App 通过 shortcutsPaused 暂停工作区快捷键，通过 WorkbenchHandle.hasContent/exportDraft 处理切换前的本地稿件。普通会话检查或同账号重新登录不能重建工作区。

MembersPanel 隐藏 organizer 对其他 organizer 的角色修改和移除入口（dev 除外），后端仍独立校验。移除其他成员使用 Modal 二次确认，移除自己经 App 的退出/稿件保护流程。组织名与添加成员表单共用 member-form 栅格对齐。账号入口、成员表和移除确认统一只显示 username，不重复展示另一份账号名。PersonalPanel 不提供显示名或资料字段；新密码/确认新密码前后端均校验，成功清空三项密码，个人设置仅保留退出账号入口。

默认键位来自根 shared/timing-shortcuts.json。设置只存动作覆盖，空列表禁用，删除键恢复全部默认别名。校验回归在 shortcuts-validation.test.ts 和 workspace-ui/timing-shortcuts.test.ts；完整交互验证在 frontend/browser-tests/user-system.mjs。

页面路由由 navigation 拥有；未登录深链接保留 URL，成功后由 App 加载原请求资源。接受不同账号仍需原稿保护并重置到入口；同账号恢复不替换实例。navigation 不请求 Session，账号客户端不解析页面 URL。

`SettingsPage.tsx` 负责独立设置页的页头、个人/组织分类导航及既有面板组合，通过显式 props 接收用户、当前组织、设置、导航和受保护动作。唯一新增直接依赖为 navigation 的链接和 Route 类型；navigation 不反向依赖 account-ui。`/settings` 或带组织上下文的 `/organizations/:organizationId/settings/personal` 展示 PersonalPanel 和退出账号/Admin，`/organizations/:organizationId/settings` 展示 MembersPanel。组织不可访问时显示明确状态与重试；无组织禁用组织入口；会话无效时禁用表单。面板不读取隐藏编辑器，App 负责退出、移除自己及组织变更时的原有保护。

设置入口和个人/组织分类默认均新开标签页，来源工作区不隐藏、不主动暂停。组织切换器只在项目列表；新页面通过显式组织 URL 延续列表/项目上下文。仅同文档历史浏览设置时隐藏工作区、暂停播放/快捷键，回退恢复内存；个人/组织设置不再用 Modal，成员移除二次确认与登录/保护继续用 Modal。未保存设置输入仍只属于面板，导航离开不自动保存。浏览器回归见 user-system.mjs（密码/快捷键/权限/保护）和 navigation.mjs（深链接/刷新/新标签页/布局/保留实例）。

音频显示偏好：Settings 增加 audio_display_mode，createDefaultSettings 为账号切换提供默认 Spectrum 和空快捷键覆盖。PersonalPanel 的「音频显示」单独显式保存该字段，快捷键保存仍只提交 shortcut_overrides；响应包含完整设置供 App 更新，面板内尚未保存的另一类输入不被覆盖。错误保留选择。App 沿用 focus/visibilitychange/30 秒检查将服务端偏好传给工作区，没有新增 Storage 或标签页通信。类型仅向下引用 media/audio 的 AudioDisplayMode；不会从编辑器内部读取模式。
