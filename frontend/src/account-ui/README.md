# 账号界面

App 编排会话、组织上下文、登录/保护弹窗及工作区所有权。App 显式创建并传递 account-ui/api.ts 客户端实例；实例负责同源 Session 请求、当前 CSRF Cookie、结构化错误、账号一致性头和旧上下文响应过滤，通过显式回调通知会话失效，不使用模块级账号全局状态。LoginForm、MembersPanel、PersonalPanel 只通过公开 HTTP 契约操作数据，不访问 EditorWorkbench 内部状态。

Modal 使用原生 dialog 的焦点约束和焦点恢复。showCloseButton 默认为 true，归档确认框设为 false，保留底部取消按钮；此属性只控制标题旁关闭按钮，不影响 Escape。onCancel 只响应弹窗自身（event.target === event.currentTarget），忽略文件 input 冒泡的 cancel，避免取消选片关闭整个表单；真正的 Escape 仍经 onClose 关闭，未提供 onClose 时阻止默认关闭。App 通过 shortcutsPaused 暂停工作区快捷键，通过 WorkbenchHandle.hasContent/exportDraft 处理切换前的本地稿件。普通会话检查或同账号重新登录不能重建工作区。

MembersPanel 隐藏 organizer 对其他 organizer 的角色修改和移除入口（dev 除外），后端仍独立校验。移除其他成员使用 Modal 二次确认，移除自己经 App 的退出/稿件保护流程。组织名与添加成员表单共用 member-form 栅格对齐。账号入口、成员表和移除确认统一只显示 username，不重复展示另一份账号名。PersonalPanel 不提供显示名或资料字段；新密码/确认新密码前后端均校验，成功清空三项密码，个人设置仅保留退出账号入口。

默认键位来自根 shared/timing-shortcuts.json，包含 delete-row（删除当前字幕行），默认 Ctrl/Meta+Delete/Backspace；Meta 对应 macOS Cmd。只有删行动作额外允许这四个组合，其余既有动作保留原可绑定范围。设置只存动作覆盖，空列表禁用，删除键恢复全部默认别名。校验回归在 shortcuts-validation.test.ts 和 workspace-ui/timing-shortcuts.test.ts；完整交互验证在 frontend/browser-tests/user-system.mjs；删行设置的录制、刷新、覆盖替换、禁用、恢复默认及输入框保护见 frontend/browser-tests/delete-shortcut-settings.mjs（模拟 API，不写开发数据库）。

页面路由由 navigation 拥有；未登录深链接保留 URL，成功后由 App 加载原请求资源。接受不同账号仍需原稿保护并重置到入口；同账号恢复不替换实例。navigation 不请求 Session，账号客户端不解析页面 URL。

PersonalPanel 的快捷键输入保留原始字符串草稿（含末尾逗号、空格与未输入完整的键码），不能在 onChange 中 split/trim/filter 后回填。只在保存或录制校验时解析成 ShortcutOverrides；成功保存后用服务端响应格式化草稿，失败保留输入。单项/全部恢复直接移除相应草稿，留空解析为空列表。浏览器回归使用 pressSequentially 验证逗号逐字输入及多绑定保存/刷新，避免只用 fill 掩盖问题。

局部 busy 在请求期间同时禁用全部快捷键输入、录制按钮/录制框、单项/全部恢复和鼠标边界勾选，成功/失败后恢复，确保响应仅确认已提交版本。延迟成功、延迟失败及失败后草稿/录制恢复见 `frontend/browser-tests/personal-settings-pending.mjs`（`npm run test:personal-settings-pending`，可设 PERSONAL_SETTINGS_URL；真实 Chrome，API 为内存夹具）。

`SettingsPage.tsx` 负责独立设置页的页头、个人/组织分类导航及既有面板组合，通过显式 props 接收用户、当前组织、设置、导航和受保护动作。唯一新增直接依赖为 navigation 的链接和 Route 类型；navigation 不反向依赖 account-ui。`/settings` 或带组织上下文的 `/organizations/:organizationId/settings/personal` 展示 PersonalPanel 和退出账号/Admin，`/organizations/:organizationId/settings/organization` 展示 MembersPanel。组织不可访问时显示明确状态与重试；无组织禁用组织入口；会话无效时禁用表单。面板不读取隐藏编辑器，App 负责退出、移除自己及组织变更时的原有保护。

设置入口默认新开标签页，来源工作区不隐藏、不主动暂停；设置页内个人/组织分类显式使用 target="_self"，在当前标签页切换并保留组织 URL 上下文。组织切换器只在项目列表；新页面通过显式组织 URL 延续列表/项目上下文。仅同文档历史浏览设置时隐藏工作区、暂停播放/快捷键，回退恢复内存；个人/组织设置不再用 Modal，成员移除二次确认与登录/保护继续用 Modal。未保存设置输入仍只属于面板，导航离开不自动保存。浏览器回归见 user-system.mjs（密码/快捷键/权限/保护）和 navigation.mjs（深链接/刷新/新标签页/布局/保留实例）。

音频显示偏好：Settings 增加 audio_display_mode，createDefaultSettings 为账号切换提供默认 Spectrum 和空快捷键覆盖。PersonalPanel 的「音频显示」单独显式保存该字段，快捷键保存提交 shortcut_overrides 和鼠标边界偏好；响应包含完整设置供 App 更新，面板内尚未保存的另一类输入不被覆盖。错误保留选择。App 沿用 focus/visibilitychange/30 秒检查将服务端偏好传给工作区，没有新增 Storage 或标签页通信。类型仅向下引用 media/audio 的 AudioDisplayMode；不会从编辑器内部读取模式。

鼠标边界点击偏好 mouse_sets_cue_boundary 默认为 true，位于「快捷键」标题下，随原「保存快捷键」按钮提交。勾选框用局部 personal-checkbox 横向布局与文字左对齐，16px 原生控件不继承普通文本框的全宽显示；不修改其他表单的默认布局。后端仅接受 boolean、按账号隔离；音频显示 PATCH 不提交此字段，也不重置未保存勾选。新增四个播放头/拆分动作均默认空绑定，仍用 shared 唯一动作表与有效绑定冲突检测；只有这四个动作扩展 Ctrl/Meta/Alt/Shift + 原基础键范围，已有动作可绑定范围与默认不变。文本拆分仅允许已配置绑定在具体字幕 textarea 聚焦时执行。详见 docs/editing-operations.md 与 editing-operations 浏览器回归。
