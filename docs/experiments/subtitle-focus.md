# 固定 Tab 字幕输入焦点

2026-10-30 实现并验证。只修改前端焦点导航，不增加账号偏好、接口或字幕数据字段。

## 交互契约

- 工作区 main 或音频 audio-stage（含字幕边界滑块）聚焦时，无修饰 Tab 聚焦当前字幕 textarea，保留光标和选区；textarea 内 Tab 返回 main，恢复打轴快捷键。
- 以 DOM 真实焦点为准，不维护第二份输入模式。focus 使用 preventScroll；不提交时间、不选下一行、不保存、不控制视频或试听。
- 工作区 main 使用 editor-workbench 类，只隐藏该容器的焦点 outline，避免返回打轴后出现整页蓝框；输入框、按钮和音频边界等控件继续显示原有焦点提示。
- 其他输入、按钮、原生 range、滚动条、分隔线与 Shift+Tab 保留原生导航，因此可以通过 Shift+Tab 离开字幕输入框。
- 长按 Tab 只切换一次，后续 repeat 仍阻止原生导航。defaultPrevented、IME composition / isComposing / keyCode 229 及修饰键均不接管。
- EditorWorkbench 复用 busy、拆分、待确认导入、样式弹窗、shortcutsPaused 和 visible 的既有保护；额外要求 canEdit、选中行和非全屏。disabled / readonly textarea 也不接管。

## 所有权与边界

`workspace-ui/subtitle-focus.ts` 公开 handleSubtitleFocusShortcut，接收原始键盘事件、IME 状态、工作区和文本框 DOM 引用，返回是否接管。仅依赖 DOM；audio-stage 是同一 workspace-ui 内的音频打轴焦点范围。EditorWorkbench 在现有唯一 keydown 监听器中、普通 timingShortcut 输入过滤之前调用，不放宽 Q/W/G 对文本输入的保护。

固定导航不加入 shared/timing-shortcuts.json；前后端个人绑定校验继续拒绝 Tab，避免与固定导航冲突。鼠标操作、文本拆分光标恢复和其他快捷键分派保留各自原入口。模块依赖未新增跨层引用或循环。

## 验证

执行环境：Node 26.4.0、真实无头 Chrome 147.0.7727.101、FFmpeg 生成 12 秒本地 MP4；隔离 API 夹具，不写开发数据库。

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run build
SUBTITLE_FOCUS_URL=http://127.0.0.1:5184 npm run test:subtitle-focus
```

- 类型检查、29 个文件 / 281 项现有单元测试、生产构建通过。
- 真实按键验证：无视频时往返；只切焦点不触发刷新离页保护；qwg 作为文本输入，返回后 Q/W 试听、G 提交下一条；保留选区；双向长按只切换一次；切换不改时间草稿、视频位置、视窗或页面滚动。
- main、音频画布、字幕边界滑块进入文本框通过；时间输入间 Tab、文本框 Shift+Tab 和按钮间 Tab 保持原生导航。原生 range、滚动条、各分隔线不接管。
- 样式弹窗保持焦点约束，待确认导入和转换繁忙期间不接管；全屏和删空无选中行不接管。
- IME 生命周期、isComposing / 229、修饰键及已处理事件使用合成事件验证过滤，不宣称覆盖真实操作系统输入法候选窗。只读 / 权限和隐藏分支经代码检查，未新增项目数据库场景验收。
- 浏览器无 pageerror 或非预期 API 请求。JSON 报告写入运行时临时目录；真实用户输入法和熟练打轴试用仍待实际使用验证。
- 整页蓝框修正：真实 Chrome 检查 Tab 返回 main 后 outline 为 none；textarea、按钮、音频画布仍为 2px solid 焦点提示，qwg 输入和返回后 G 提交通过。已检查页面截图，生产构建（含类型检查）及 git diff --check 通过；本次纯样式修正未重跑全部单元测试。
