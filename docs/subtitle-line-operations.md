# 字幕行操作

2026-11-07 用户确认：Ctrl/Cmd 多选、Shift 连选及批量操作；列表继续按时间排序；before/after 只决定文档 / ASS Dialogue 顺序；粘贴覆盖只开放入点、出点、样式、正文。

## 行为契约

- 点击任意行单元格选择；Ctrl（macOS 用 Cmd）切换单行，Shift 按可见时间顺序从锚点连选，Ctrl/Cmd+Shift 合并范围。active row 与整组选中 ID、连选锚点一起保存在既有编辑状态；纯选择不增加历史步骤，下一次编辑精确捕获它们。
- 右键未选行切换为单选；右键已选行保留整组并将该行设为 active。右键不定位视频。活动行有未应用的时间草稿时，打开菜单先保留活动行和原始输入。选择其他行命令时按原规则设定目标；尝试合并时提示先应用时间草稿或恢复原值。鼠标右键打开时聚焦菜单容器，不预先高亮任何操作；Shift+F10 / ContextMenu 打开时聚焦首个可用操作。方向键、Home/End 导航，Esc/Tab 关闭并返回工作区焦点；外部点击、滚动、窗口变化与失焦关闭。隐藏、忙碌或弹窗时不可打开。
- 所有行操作使用已应用时间，不隐式提交时间草稿。一次插入 / 整批重复、帧分割、合并、删除、剪切或粘贴覆盖为一条撤销步骤，恢复完整文档、选择和原始时间草稿。复制不增加步骤。项目行菜单操作修改当前工作区，仍需手动保存。
- 插入为空正文、继承 active 样式，默认 3000ms；before 结束于 active 入点，after 开始于 active 出点。扫描全部字幕，收缩到可用的最近出点 / 入点。紧贴边界时仍插入起止相同的零时长行，零点前插入为 0–0；选中新行供后续调整，不自动拉长。视频插入始于当前帧起点，固定 3000ms；前后只决定文档位置。
- 重复按文档中连续选中块在各块之后插入副本，保留正文、样式与原始 Layer/Name/Margins 锚点。帧前分割在当前帧起点，帧后分割在当前帧终点，保留两份正文并选中副本；当前帧不在原行内时，原行保留，副本仅覆盖本帧。
- 视频帧由 `media/video-frame.ts` 按操作读取本地文件实际 presentation timestamp / duration，使用已有 Mediabunny metadataOnly packet API，支持可解析的 VFR / B-frame 文件，不依赖平均 FPS、不解码画面，finally 释放 input。不可读取或 10ms 精度不足时明确拒绝，无假定帧率回退。
- 保持非负 10ms 网格、10 小时 / 5000 行 / ASS 子集限制；已应用字幕允许 start = end，但倒序仍拒绝。零时长行可编辑、重复、保存和 ASS 往返，QC 只警告时长过短，不计算 CPS；空选区试听不播放。分割产生零时长时仍整批拒绝，原稿和历史不变。原有 G/Enter 自动续行仍为 2000ms，与 Aegisub 菜单插入的 3000ms 分开。

Aegisub 规则依据：[插入实现](https://github.com/TypesettingTools/Aegisub/blob/master/src/command/subtitle.cpp)、[重复/分割/剪贴板实现](https://github.com/TypesettingTools/Aegisub/blob/master/src/command/edit.cpp)、[默认时长](https://github.com/TypesettingTools/Aegisub/blob/master/src/libresrc/default_config.json)。2026-11-12 按用户确认支持紧贴插入零时长，见 [实施边界与验证](plans/zero-duration-insertion.md)；保持现有受限 ASS 支持范围。

## 合并字幕行

### Aegisub 3.5.1 调研

官方手册的字幕表菜单列出 Keep First、Concatenate 和 As Karaoke。Keep First 只取首条正文，Concatenate 把每段正文用空格拼接，As Karaoke 为各段生成卡拉 OK 定时标签。手册把出点描述为最后一行的出点。 [Aegisub 手册](https://aegisub.org/docs/latest/editing_subtitles/#the-subtitles-grid)

- 在 `TypesettingTools/Aegisub` 的 3.5.1（`088ca6caa878209e279871f8897273f49342372b`），`validate_sel_multiple` 只要求选中两条以上。`combine_lines` 按 `GetSortedSelection` 返回的行序操作，行号来自 `AssFile::Commit` 对 `Events` 的编号，`BaseGrid::UpdateMaps` 也遍历该事件列表。允许非连续、多样式、未加载视频的选择。 [发布版本](https://github.com/TypesettingTools/Aegisub/releases/tag/v3.5.1) · [命令校验](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/command/edit.cpp#L91-L96) · [选择顺序](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/selection_controller.cpp#L54-L58) · [事件编号](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/ass_file.cpp#L193-L204) · [表格映射](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/base_grid.cpp#L204-L210)
- 三种命令均原位保留第一条选中事件，入点保持第一条的入点，出点取所有选中事件的最大出点。保留首条事件的 ID、样式、Layer、Actor、边距、Effect、Comment 状态和其他字段；删除其余选中事件，单选并激活幸存行。合并时间横跨间隙，重叠不改变拼接规则，出点相同的零时长行可以合出零时长。若文件未按时间排序，后面事件更早的入点不会扩展合并后的时间范围。 [合并函数和命令](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/command/edit.cpp#L756-L817)
- `combine_concat` 每个边界加一个普通空格，重复、空正文和原有空白都参与拼接。原有 `\N` 等转义原样保留，无自动换行、标签闭合或样式重置。例如 `{\i1}甲` 与 `乙` 变成 `{\i1}甲 乙`，斜体延续；后续行的基础样式不会跟随正文。`combine_karaoke` 在每段前加 `\k`，长度为该段自身时长除以 10（厘秒），间隙不会加入时长，重叠不会扣减，零长度得到 `\k0`。 [拼接与卡拉 OK 函数](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/command/edit.cpp#L772-L784) · [ASS 标签作用域](https://aegisub.org/docs/latest/ass_tags/#override-tags)
- 一次合并只提交一次，Undo/Redo 通过事件快照恢复内容和 ID。合并在 Commit 前发出单选幸存行的信号，而 `OnSelectionChanged` 会更新上一份撤销快照。由此可推断撤销会恢复原事件，但不能依赖它恢复原多选。 [选区信号](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/selection_controller.cpp#L42-L52) · [快照内容与恢复](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/subs_controller.cpp#L53-L142) · [选区监听与撤销](https://github.com/TypesettingTools/Aegisub/blob/088ca6caa878209e279871f8897273f49342372b/src/subs_controller.cpp#L354-L390)

### CueRelay 契约

本地与项目工作区的字幕行菜单提供「合并字幕行」，采用 Concatenate。连选仍按表格所见时间顺序，合并时按选中 ID 查找文档中的 ASS Dialogue 顺序。比如文件里先写 `晚句`（3–4 秒）、再写 `早句`（0–5 秒），选中两条得到 `晚句 早句`（3–5 秒），保留 `晚句` 的样式和隐藏 ASS 字段。可以合并跨间隙、重叠、零时长或不同样式的选中行。只提供保留所有正文的普通合并；Keep First 会丢弃正文，As Karaoke 超出现有 ASS 子集。

纯转换保留首条 cue 的 ID、`source_id` 和可选 `ass_fields`，以及未选中 Dialogue 的相对顺序。Comment 等模板记录沿用现有 Dialogue 槽位序列化规则。原始 ASS 模板、样式和脚本设置共享原快照。命令通过现有完整 ASS 序列化器预检，包括单行 16384 字符和文件大小。校验失败、权限失效、工作区隐藏或快照已变化时，保留执行前的字幕。成功只提交一次历史编辑，选中幸存行。撤销恢复执行前的全部 cue、活动行、多选、锚点和时间输入，重做复用原 ID。CueRelay 表格的合并目标是 Dialogue，Comment 保留在 ASS 模板中。合并时播放头保持原位，预览、QC 和查找跟随现有文档更新。项目仍显式保存并校验 revision。

纯规则回归位于 `frontend/src/subtitle-model/cue-merge.test.ts`，真实浏览器、ASS 往返与隔离数据库回归位于 `frontend/regression/cue-merge.spec.mjs`（`WorkspaceRegressionTests.test_workspace_merge_project`、`test_workspace_merge_local`）。

## 剪贴板与格式

浏览器使用系统纯文本剪贴板，复制为标准字段顺序 ASS Dialogue，可与 Aegisub 互通。保留正文中的逗号、ASS 转义和隐藏元数据。不复制内部 UUID。浏览器不允许访问时报告错误；剪切只有在复制成功且仍为同一有效快照时才删行。复制失败、网络失败、权限变化、隐藏或实例销毁不得应用迟到修改。

普通文本按非空物理行转换为 0–3000ms 的字幕，使用 active 样式（空文档为首个样式）。ASS 行通过 codec 的原有严格预检；未找到的样式名回退 active 样式，不隐式导入样式。未知特效、标签及无效时间整批拒绝。不能粘贴整份 ASS 文件，文件导入仍走原入口。

粘贴插入在 active 之前，空文档可通过快捷键粘贴。粘贴覆盖先读取剪贴板快照，再弹四项复选框，默认只覆盖正文；单选从 active 向文档末尾覆盖，多选按文档顺序仅覆盖选中行，超额剪贴板行忽略。保留目标 ID、active / 多选 / 锚点和未勾选字段（包括未勾选端点的原始时间草稿、目标隐藏元数据）；无变化覆盖不增加历史步骤；完整结果验证失败时弹窗保留字段选择，允许调整并重试。

`ass_format/clipboard.py` 在普通插入时为新行附加可选 `ass_fields`（Layer/Name/MarginL/MarginR/MarginV 五个有界字符串），仅供剪贴板元数据保留，不开放新的编辑字段。原始 source、styles、script 不变，复用项目既有模板不可替换校验；不修改数据库结构。序列化只允许 new 行携带完整、严格验证的 ass_fields，其他字段和未知标签仍拒绝。`codec.serialize_ass` 以 `document.cues` 为 Dialogue 顺序，依次填原 Dialogue 槽位，多出行置于 Events 末尾；保留 Comment、分号注释和其他支持的模板记录。source ID 只拥有原始元数据，不再决定输出位置。

## 模块与 API

- `workspace-ui/line-selection.ts`：纯选择集合、可见范围规则。
- `line-edits.ts`：纯插入、重复 / 帧分割、批量删除，无 DOM / HTTP。
- `use-line-commands.ts`：异步帧 / 剪贴板编排、快照与权限有效性、粘贴覆盖弹窗生命周期；不持有第二份可编辑文档。
- `CueTable → CueContextMenu`：展示与菜单焦点；`EditorWorkbench` 显式传选择、可用性、操作回调，并唯一组合历史、媒体和持久化。
- `line-actions.ts`：命令身份。shared/timing-shortcuts.json 唯一声明标签与默认，设置自动枚举，前后端校验一致；旧显式绑定优先于新增默认。输入框、IME、长按保留原有过滤。
- `project-data/ass-api → POST /api/ass/clipboard → ass_format/clipboard → codec`：无状态转换，不访问 Session / 组织 / 项目 / 数据库。copy 请求 `{document, ids}` 返回 `{text}`；paste 请求 `{document, text, active_id, ids, fields}` 返回 `{document, selected_ids}`，`fields=null` 表示插入，其他为四项非空子集。空文档插入使用 active_id=null、ids=[]。字段集合错误 400；格式错误 422；请求体超限 413。
- 通用 `Modal` 从 account-ui 下移到 `page-ui`，实现不变，所有调用者显式导入共享展示模块，避免工作区为覆盖弹窗反向依赖账号界面（账号设置已依赖工作区快捷键叶子）。

## 验证

- `cd frontend && npm test -- --run`；`npm run build`。
- `PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/ass_format -t backend`。
- `DJANGO_SECRET_KEY=local-test-only .venv/bin/python backend/manage.py test http_api.test_clipboard http_api.tests.ConversionContractTests accounts.test_shortcuts`（仅无数据库测试）。
- Chrome / FFmpeg / Vite：`cd frontend && npm run test:subtitle-line-menu`，默认 http://127.0.0.1:5201，可设 LINE_MENU_URL。系统剪贴板权限、真实 MP4 / 纯 Python codec、隔离 HTTP fixture，不写开发数据库。
- 原有查找、撤销与 Modal 调用的浏览器回归见 [执行记录](experiments/subtitle-line-menu.md)。
