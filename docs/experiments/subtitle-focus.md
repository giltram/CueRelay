# 字幕输入焦点切换

2026-10-30 实现并验证默认 Tab，随后增加个人设置中的 Tab / Ctrl+Space 两选一。复用账号 shortcut_overrides，不增加数据库字段、迁移或字幕数据字段。

## 交互契约

- 工作区 main 或音频 audio-stage（含字幕边界滑块）聚焦时，当前绑定聚焦字幕 textarea，保留光标和选区；textarea 内再按返回 main，恢复打轴快捷键。默认 Tab，可在个人设置「快捷键 → 字幕输入焦点切换」下拉框改为 Ctrl+Space，随「保存快捷键」保存；不提供自由录制、多别名或禁用。
- 以 DOM 真实焦点为准，不维护第二份输入模式。focus 使用 preventScroll；不提交时间、不选下一行、不保存、不控制视频或试听。
- 工作区 main 使用 editor-workbench 类，只隐藏该容器的焦点 outline，避免返回打轴后出现整页蓝框；输入框、按钮和音频边界等控件继续显示原有焦点提示。
- 改为 Ctrl+Space 后 Tab 恢复普通导航，「全部恢复默认」恢复 Tab。其他输入、按钮、原生 range、滚动条、分隔线与 Shift+Tab 保留原生行为；字幕框内单独空格仍正常输入。
- 长按当前绑定只切换一次，后续 repeat 仍阻止原生行为。defaultPrevented、IME composition / isComposing / keyCode 229 及不匹配的修饰组合均不接管；Ctrl+Space 不接受 Cmd、Alt、Shift 额外修饰键。
- EditorWorkbench 复用 busy、拆分、待确认导入、样式弹窗、shortcutsPaused 和 visible 的既有保护；额外要求 canEdit、选中行和非全屏。disabled / readonly textarea 也不接管。

## 所有权与边界

`workspace-ui/subtitle-focus.ts` 公开 handleSubtitleFocusShortcut，接收原始键盘事件、IME 状态、工作区 / 文本框 DOM 引用和当前绑定，复用 timing-shortcuts.bindingFor 精确匹配修饰键，返回是否接管。audio-stage 是同一 workspace-ui 内的音频打轴焦点范围。EditorWorkbench 从 effectiveBindings 计算当前键位，在现有唯一 keydown 监听器中、普通 timingShortcut 输入过滤之前调用，不放宽 Q/W/G 对文本输入的保护。普通 timingShortcut 明确排除此导航动作，避免进入提交 / 试听分派。

shared/timing-shortcuts.json 的 toggle-text-focus 唯一声明标签、默认 Tab 和 allowed_bindings（Tab、Ctrl+Space）。双端要求恰选一个，拒绝裸字母、Shift+字母、其他组合、空列表和多绑定；其他动作的可绑定范围保持不变。沿用有效绑定冲突检查，例如 split-text 已占用 Ctrl+Space 时，选择同键必须先解决冲突。覆盖 Tab 归一化为空覆盖，旧账号默认不变；音频显示部分更新保留选择。App 沿用设置更新 / 聚焦 / 定期检查，将设置传入保留工作区，不新增模式状态或同步通道。依赖方向为 EditorWorkbench → subtitle-focus → timing-shortcuts → media/playback，无反向引用或循环。

## 验证

执行环境：Node 26.4.0、真实无头 Chrome 147.0.7727.101、FFmpeg 生成 12 秒本地 MP4；隔离 API 夹具，不写开发数据库。

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run build
SUBTITLE_FOCUS_URL=http://127.0.0.1:5184 npm run test:subtitle-focus
PERSONAL_SETTINGS_URL=http://127.0.0.1:5184 npm run test:personal-settings-pending
# 仓库根目录，按 README 加载 .env 后：
.venv/bin/python backend/manage.py test accounts.test_shortcuts http_api.test_identity.IdentityTests.test_subtitle_focus_shortcut_persistence_validation_and_restore --noinput
```

- 类型检查、30 个文件 / 306 项前端单元测试、生产构建通过；后端 6 项双端规则 / API 测试使用独立测试库通过并清理，未修改开发账号数据。验证持久化、音频部分更新、账号隔离、非法绑定、失败原子性、冲突及恢复默认。
- 真实按键验证：无视频时往返；只切焦点不触发刷新离页保护；qwg 作为文本输入，返回后 Q/W 试听、G 提交下一条；保留选区；双向长按只切换一次；切换不改时间草稿、视频位置、视窗或页面滚动。
- main、音频画布、字幕边界滑块进入文本框通过；时间输入间 Tab、文本框 Shift+Tab 和按钮间 Tab 保持原生导航。原生 range、滚动条、各分隔线不接管。
- 设置页只提供两个下拉选项；Ctrl+Space 保存后刷新保留，通过现有 focus 检查应用到原工作区，视频 DOM 身份、字幕、时间草稿和视窗保持不变。Ctrl+Space 双向切换、长按、精确修饰键、IME 保护、qwg 和空格输入、Tab 原导航、返回后 G 提交及恢复 Tab 通过。已检查设置页截图。
- 延迟保存期间下拉框和原快捷键控件同时禁用，成功恢复、失败保留提交前选择并允许继续修改；音频偏好与快捷键保存流程不互相替换草稿。
- 样式弹窗保持焦点约束，待确认导入和转换繁忙期间不接管；全屏和删空无选中行不接管。
- IME 生命周期、isComposing / 229、修饰键及已处理事件使用合成事件验证过滤，不宣称覆盖真实操作系统输入法候选窗。只读 / 权限和隐藏分支经代码检查，未新增项目数据库场景验收。
- 浏览器无 pageerror 或非预期 API 请求。JSON 报告写入运行时临时目录；Ctrl+Space 按键为自动化浏览器事件，不代表已验证真实 Windows / macOS 系统保留键。系统或输入法抢占时需用户调整系统设置或使用默认 Tab；真实输入法和熟练打轴试用仍待实际使用验证。
- 整页蓝框修正：真实 Chrome 检查 Tab 返回 main 后 outline 为 none；textarea、按钮、音频画布仍为 2px solid 焦点提示，qwg 输入和返回后 G 提交通过。已检查页面截图，生产构建（含类型检查）及 git diff --check 通过；本次纯样式修正未重跑全部单元测试。
