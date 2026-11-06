# 工作区编辑状态与历史

EditorWorkbench 编排媒体、字幕 UI、预览及显式持久接口；`use-edit-history.ts` 唯一拥有本实例的可编辑状态，`edit-history.ts` 是无 React / DOM 依赖的不可变历史转换。依赖方向：EditorWorkbench → use-edit-history → edit-history → contracts；音频组件只报告操作与生命周期，不读取历史。

## 历史契约

每个状态包含 `document`、`selectedId`、原始 `startText` / `endText`。文档和未修改子对象共享引用，每步保存 before/after 引用，最多 100 步；不逐步深拷贝。File、PCM、媒体位置、视窗/缩放、服务端 revision、savedDocument 均不在历史内。

所有修改入口经 `edit`：边界单击、时间输入、文本、行样式、播放头裁剪、提交、删除、拆分、本地样式/脚本操作。纯选行经 `navigate`，不生成步骤，但下一编辑准确捕获当时的选行及草稿。纯媒体动作不改编辑状态。成功加载/导入经 `baseline`；失败、相同值和校验拒绝不增加步骤，也不清除重做分支。新编辑清除重做。

- 左击入点 / 右击出点每次有效修改一步。
- 边界 pointerdown 发起一次工作区手势，pointerup / pointercancel / lostpointercapture / blur 结束，最终结果为一步（cancel 保留已发生的修改）。回到原始草稿不留步骤。撤销、其他编辑、隐藏/忙碌/弹窗等边界让旧令牌失效；迟到的 pointermove 不能再次写入。音频层只持有手势句柄和 pointer capture。
- 方向键单按一步；同一按键 repeat 到 keyup、blur、切换按键或其他操作合并一步。撤销后忽略尚未释放的重复按键。窗口失焦也结束分组。
- 文本和时间输入按字段、选中行分组，连续输入间隔不超过 1 秒；blur、其他操作、compositionstart/end 结束分组，IME 合成期间不按停顿拆组。原始时间字符串直接保存，非法/未完成输入也可恢复。
- 输入框内 Cmd/Ctrl+Z、Shift+Z 留给原生输入。收到真实 `inputType=historyUndo/historyRedo` 且值实际变化时，应用字段级修改并建立**新的工作区历史基线**，清除工作区过去/未来，保留浏览器自己的重做。浏览器栈不可枚举，这个显式安全边界避免重复重做或重放过期快照。工作区撤销/重做及换行选择通过元素 key 重建相关输入，阻断旧行或旧快照的原生栈。无需猜测浏览器原生分组与工作区分组一致。
- G/Enter 的提交、选下一条和末尾新增行作为一条原子步骤。重做直接复用生成后的文档和 UUID。删除含删空同样恢复原选择和草稿。
- 文本、时间、字幕样式和本地样式管理按顺序撤销。完整文档快照包含样式定义与引用，因此不会把旧时间快照盖到较新文字上或产生悬空 style_id。样式管理弹窗本身暂停工作区快捷键；其表单草稿不入字幕历史，应用成功才入历史。项目设置页修改独立服务器快照，保留工作区通过显式重载接纳。

撤销/重做取消旧试听，不 seek 视频，也不触发选择导致的音频 revealInterval；保留视窗和缩放。全局快捷键复用可见性、忙碌、权限、媒体验证、待确认导入、弹窗与 IME 过滤，不抢原生输入撤销。默认键唯一来源为 shared/timing-shortcuts.json。已有个人显式绑定优先于新增 undo/redo 默认别名；显式配置之间冲突仍由前后端拒绝。

## 保存与生命周期

手动保存不清空历史；savedRevision / savedDocument 独立更新，撤销后仍按最新 revision 手动保存。时间草稿仍需提交才进入保存快照。

项目拆分成功立即保存完整快照，并独立更新 revision/保存基准；本地一步历史可恢复拆分前完整编辑状态。撤销不发送请求，下一次手动保存才更新服务器；失败不修改内容、草稿或历史。本地拆分无持久化。

普通导出和离开前的备份导出统一调用 `exportDraft`，文件名由 `export-filename.ts` 生成：`项目名称_YYYY-MM-DD_HH-mm-ss.ass`，使用下载时的浏览器本地时间（精确到秒）。名称替换文件系统非法字符并限制为 80 个字符；本地工作区使用 `cuerelay` 前缀。只导出当前已应用的文档，不提交时间草稿或保存项目。

成功导入建立新基线、清除旧历史；失败保留。实例隐藏/恢复保留历史；显式重载、切项目/组织/账号和销毁由 app-workspace/App 的原有 clear/挂载 generation 生命周期创建新历史。无跨刷新恢复、跨标签页/多人撤销、自动保存或持久历史。

## 验证入口

`edit-history.test.ts` 验证状态恢复、分组、分支、100 步上限、失败/无变化、提交 UUID、删空和文字/样式交错；`timing-shortcuts.test.ts`、`backend/accounts/test_shortcuts.py` 验证双端默认/兼容/冲突。

`cd frontend && npm run test:workspace-history`：真实 Chrome、FFmpeg、本地 Vite（默认 5189，可用 HISTORY_URL 覆盖），HTTP 使用隔离 fixture，ASS 拆分/样式用真实 Python 纯转换，不写开发数据库。覆盖手势/中途撤销、重复方向键、原生输入事件、CDP IME、提交/删除、样式、导入、保存/拆分 revision 和实例保留/替换。

本次实际验证结果及浏览器/旧音频套件限制见 [历史验证记录](../../../docs/experiments/workspace-history.md)。

## 字幕输入焦点

默认 Tab，可在个人快捷键设置选择 Ctrl+Space。共享 JSON 唯一声明默认和允许列表，EditorWorkbench 通过 effectiveBindings 计算当前绑定并显式传给 subtitle-focus.ts。后者仅在 main、audio-stage（含边界滑块）和当前字幕 textarea 之间切换 DOM 焦点，保留光标、选区及现有可用性 / IME / 长按保护。timingShortcut 不返回该导航动作，避免进入提交或试听分派。改绑释放旧 Tab，其他控件和 Shift+Tab 保持原生导航；切换不进入编辑历史。验证见 [焦点切换记录](../../../docs/experiments/subtitle-focus.md)。

## 诊断

use-edit-history 向只读 edit-diagnostics 观察器报告已有 before/after 引用，按连续输入/手势合并逐行差异；诊断自身 flush 不结束历史分组。导出通过账号/组织受限 getter 读取未保存状态、当前 revision、video 技术状态、试听和预览，不提交时间草稿或操纵业务状态。范围/敏感边界/预算见 [diagnostics](../diagnostics/README.md)。

## 字幕文本查找

字幕列表标题「查找」切换一行查找条，展开时按钮使用既有选中配色（aria-pressed）并聚焦输入；没有独立关闭按钮。可见工作区内 Ctrl/Cmd+F 打开查找，已展开时再次按快捷键只聚焦并选中查找文字。查找框及前后按钮高 28px，整条高 32px，减少纵向占用，把剩余空间交给字幕列表。保留完整列表、时间排序和行号。输入只更新匹配及 React 文本节点高亮，不选行、不滚动、不提交时间草稿、不操纵媒体。

- `cue-search.ts` 是纯函数入口：`matchCueText` 返回原始正文的 UTF-16 高亮范围；`findCueMatches` 复用 `subtitle-model/cue-order.ts` 的 `orderCues`，每行一个结果；`navigateCueMatches` 通过 cue ID 计算包含当前选行的首次查找及后续前后循环。
- 匹配当前文档（包含未保存正文），普通字面文本，英文 A–Z 不区分大小写。只忽略 codec 已支持的 `b/i/u/s` 0/1 组合标签，`\N` / `\n` / `\h` 各视作一个空格；不修剪关键词或折叠空白。非法/未完成的标签按字面文本处理，查找不验证或修改原稿。列表继续展示原文，因此跨标签匹配会分段高亮，空白匹配高亮对应原始转义。
- `use-cue-search.ts` 仅拥有本列表的开关、关键词和当前命中 ID；派生结果不另存字幕。关键词变化重置游标，首次前后查找从当前选行开始（含本行），未选行从首/末结果开始；尚未跳转显示 `0 / N 行`。当前命中不再匹配/被删除时恢复首次规则，修改或重排仍按 ID 识别。
- `CueSearchBar` 隔离工作区快捷键、处理 IME Enter（composition、isComposing、229）并通过 polite live region 报告数量。输入框 Enter/Shift+Enter 和前后按钮调用显式导航，按钮保留原生键盘激活；连续导航焦点回到查找框。空字符串无高亮，无匹配时禁用前后按钮。
- `CueTable` 用行 ref 在主动跳转时只滚动自身容器（避开 sticky 表头），然后复用传入的 `selectCueFromTable`：重复选择同一 cue ID 保留原始时间草稿（含未完成/非法输入），真正换行才丢弃旧草稿并载入目标行已提交时间。行号、正文点击和查找定位共用此规则；仍取消试听，有可播放视频时暂停并定位该行已提交入点，无视频时仍可选行。查找无独立提交/保存逻辑，也不生成历史步骤。
- `EditorWorkbench` 仅传可用性、工作区 ref 和已有选行回调，主容器鼠标点击聚焦跳过 `data-cue-search` 控件。查找不受可编辑权限/媒体验证限制，但隐藏、忙碌、导入确认、工作区/账号弹窗时不拦截 Ctrl/Cmd+F。初始 body 焦点也可打开当前可见工作区查找；其他页面保留浏览器查找。
- Esc 或再次点击「查找」收起查找条并移除高亮，保留选行和视频位置，焦点返回工作区。关键词在本实例关闭/重开及隐藏/恢复时保留；重开重新按首次规则导航，实例销毁时清空。无搜索历史、替换、过滤、正则、网络请求或持久化。

依赖方向：`EditorWorkbench → CueTable → {use-cue-search, CueSearchBar, CueSearchText}`；`use-cue-search → cue-search → {subtitle-model/cue-order, contracts}`，展示组件只依赖类型及 React，不反向导入编排层。

验证：`cue-search.test.ts`；`npm run test:subtitle-search`（真实 Chrome、FFmpeg、本地 Vite、隔离 HTTP fixture，无数据库写入）。实际结果与浏览器限制见 [查找验证记录](../../../docs/experiments/subtitle-search.md)。

## 紧凑布局与提示

EditorWorkbench 使用 page-ui 的 PageLayout / HeaderNotice：44px 顶栏容纳保存状态、错误、字幕预览及 App 注入的会话提示，长消息在栏内滚动。移除未校验片源时的选片提示，编辑权限仍要求原有完整校验。入点/出点/样式和定位/删除共用一行，窄栏可横向滚动；上方区域从原 54dvh（400–560px）减少 52px，省出的空间交给字幕表，不能只让音频画布增长。字幕导入替换确认和样式 dialog 保持原有交互及焦点边界。LocalVideoPlayer 不再持有预览 status 插槽；预览消息由工作区直接交给顶栏，媒体校验反馈也在顶栏中显示。

回归：`npm run test:compact-layout` 覆盖桌面/短窗口/窄屏、验证与保存前后高度、设置下载及隐藏实例隔离。

## 分隔栏联动预览高度

`ResizableWorkbench` 组合 media / editor / subtitles 三个展示插槽，拥有上下区域和左右分栏的唯一尺寸状态；不访问字幕或视频内部状态。默认仍用紧凑布局。显式向右拖动分隔栏超过当前视频高度限制时，以 16:9 反推上方所需高度，把字幕列表空间转给预览；左拖缩回，双击恢复默认宽高，键盘沿用方向键 / Shift / Home / End。右侧编辑区最低 480px，字幕区最低 144px（CSS --subtitle-min-height 唯一声明），达到任一边界停止增大。

ResizeObserver 观察布局容器、上方区域和字幕容器，读取实际可用高度、边框、控件预算及 CSS 最低高度；不能把当前上方高度再当成整个布局的高度预算，否则会锁住继续放大。只保存用户请求的宽度比例，额外高度由该宽度派生；反向拖动无需第二份高度状态。窗口缩小重新约束，窄屏隐藏分隔栏并释放进行中的 Pointer Capture，恢复桌面保留比例。实例保留/替换语义不变，无账号或 Storage 偏好。

`workbench-sizing.ts` 是纯尺寸公式入口；`workbench-sizing.test.ts` 验证高度预算及宽度边界。`npm run test:workbench-resize` 用实际工作区、真实 Chrome/MP4 与隔离 HTTP 检查拖动增高、最低高度、窗口缩小、双击/键盘、断点释放和媒体/字幕草稿不变。

实际结果与限制见 [分隔栏验证](../../../docs/experiments/workbench-resize.md)。
