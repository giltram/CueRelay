# 字幕行操作

2026-11-07 用户确认：Ctrl/Cmd 多选、Shift 连选及批量操作；列表继续按时间排序；before/after 只决定文档 / ASS Dialogue 顺序；粘贴覆盖只开放入点、出点、样式、正文。

## 行为契约

- 点击任意行单元格选择；Ctrl（macOS 用 Cmd）切换单行，Shift 按可见时间顺序从锚点连选，Ctrl/Cmd+Shift 合并范围。active row 与整组选中 ID、连选锚点一起保存在既有编辑状态；纯选择不增加历史步骤，下一次编辑精确捕获它们。
- 右键未选行切换为单选；右键已选行保留整组并将该行设为 active。右键不定位视频。同一 active row 保留未完成时间草稿。鼠标右键打开时聚焦菜单容器，不预先高亮任何操作；Shift+F10 / ContextMenu 打开时聚焦首个可用操作。方向键、Home/End 导航，Esc/Tab 关闭并返回工作区焦点；外部点击、滚动、窗口变化与失焦关闭。隐藏、忙碌或弹窗时不可打开。
- 所有行操作使用已应用时间，不隐式提交时间草稿。一次插入 / 整批重复、帧分割、删除、剪切或粘贴覆盖为一条撤销步骤，恢复完整文档、选择和原始时间草稿。复制不增加步骤。项目操作仅修改内存，仍需手动保存；原有 split-playhead / split-text 的立即保存例外不变。
- 插入为空正文、继承 active 样式，默认 3000ms；before 结束于 active 入点，after 开始于 active 出点。扫描全部字幕，收缩到可用的最近出点 / 入点。视频插入始于当前帧起点，固定 3000ms；前后只决定文档位置。
- 重复按文档中连续选中块在各块之后插入副本，保留正文、样式与原始 Layer/Name/Margins 锚点。帧前分割在当前帧起点，帧后分割在当前帧终点，保留两份正文并选中副本；当前帧不在原行内时，原行保留，副本仅覆盖本帧。
- 视频帧由 `media/video-frame.ts` 按操作读取本地文件实际 presentation timestamp / duration，使用已有 Mediabunny metadataOnly packet API，支持可解析的 VFR / B-frame 文件，不依赖平均 FPS、不解码画面，finally 释放 input。不可读取或 10ms 精度不足时明确拒绝，无假定帧率回退。
- 保持现有正时长、非负 10ms 网格、10 小时 / 5000 行 / ASS 子集限制；无间隙或分割出现零时长时整批拒绝，原稿和历史不变。原有 G/Enter 自动续行仍为 2000ms，与 Aegisub 菜单插入的 3000ms 分开。

Aegisub 规则依据：[插入实现](https://github.com/TypesettingTools/Aegisub/blob/master/src/command/subtitle.cpp)、[重复/分割/剪贴板实现](https://github.com/TypesettingTools/Aegisub/blob/master/src/command/edit.cpp)、[默认时长](https://github.com/TypesettingTools/Aegisub/blob/master/src/libresrc/default_config.json)。本项目保护性拒绝零时长，并保持现有受限 ASS 支持范围。

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
