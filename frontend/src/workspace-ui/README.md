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

成功导入建立新基线、清除旧历史；失败保留。实例隐藏/恢复保留历史；显式重载、切项目/组织/账号和销毁由 app-workspace/App 的原有 clear/挂载 generation 生命周期创建新历史。无跨刷新恢复、跨标签页/多人撤销、自动保存或持久历史。

## 验证入口

`edit-history.test.ts` 验证状态恢复、分组、分支、100 步上限、失败/无变化、提交 UUID、删空和文字/样式交错；`timing-shortcuts.test.ts`、`backend/accounts/test_shortcuts.py` 验证双端默认/兼容/冲突。

`cd frontend && npm run test:workspace-history`：真实 Chrome、FFmpeg、本地 Vite（默认 5189，可用 HISTORY_URL 覆盖），HTTP 使用隔离 fixture，ASS 拆分/样式用真实 Python 纯转换，不写开发数据库。覆盖手势/中途撤销、重复方向键、原生输入事件、CDP IME、提交/删除、样式、导入、保存/拆分 revision 和实例保留/替换。

本次实际验证结果及浏览器/旧音频套件限制见 [历史验证记录](../../../docs/experiments/workspace-history.md)。
