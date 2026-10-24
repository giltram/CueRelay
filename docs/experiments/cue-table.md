# 字幕列表列顺序、列宽与 CPS

2026-10-24：保留行号，其后为入、出、CPS、style、字幕文本。表格移除定位操作列，文字列使用剩余空间，窄屏在表格内部横向滚动。空文本显示弱化色斜体 `（empty）`，不写回字幕正文。

默认行号宽 44px，入/出各 100px、CPS 44px、style 88px；后四列都可拖动表头右边界，文字列使用剩余空间，至少保留 180px。`cue-column-widths.ts` 统一默认值/上下限/表格最小宽度，CueTable 通过 colgroup 和 fixed layout 应用并持有宽度状态。`CueColumnResizeHandle` 只拥有 Pointer Capture / 键盘交互：方向键 8px、Shift 24px、Home/End 到上下限、双击该边界恢复默认；pointercancel / lostpointercapture 停止拖动。列宽只留当前工作区内存，同页浏览列表再回退保留；刷新或更换工作区恢复默认，不新增 Storage 或账号偏好。

`workspace-ui/cue-cps.ts` 从当前文本、已应用入出点派生整数 CPS；忽略 ASS 块、空白（包括 `\N` / `\n` / `\h`）和标点，按 Unicode 字素计数，向下取整。非正或非有限时长显示 `—`。参考 [Aegisub 网格计算](https://github.com/TypesettingTools/Aegisub/blob/master/src/grid_column.cpp)、[计数实现](https://github.com/TypesettingTools/Aegisub/blob/master/libaegisub/common/character_count.cpp) 与[默认忽略选项](https://github.com/TypesettingTools/Aegisub/blob/master/src/libresrc/default_config.json)；未复制其短时长/高值隐藏或告警配色。不使用尚未提交的时间草稿，也不修改 ASS/API/保存数据。CueTable 按 cues 引用缓存排序与 CPS，播放位置变化不重复做文字分段。

「视频仅在本机播放，不会上传。」原本是 LocalVideoPlayer 的导入控件 title，移除后透明覆盖在标签上的原生 file input 仍会显示浏览器默认的 `No file chosen`。现改为真实「导入视频」按钮，通过 ref 同步 click 完全隐藏的 input，原生文件框不再参与鼠标命中；保留鼠标/Enter 选片、取消不清空、视频校验和片源固定。选片固定后的更换提示与禁用仍保留。

## 验证与复跑

- `npm run test -- --run`：22 个文件、208 项通过，CPS 测试覆盖汉字、样式块、换行/空格/标点、组合字符/emoji、空字幕和无效时长；列宽测试覆盖紧凑默认、各列上下限、独立重置和文字最小空间。
- `npm run build`（包含 TypeScript 检查）：通过。
- Chrome 147.0.7727.101，`cd frontend && npm run test:cue-table`：通过。实际应用页面内拦截账号/空文档接口，验证列顺序、选行、文本编辑、style 位置、时间草稿提交前后 CPS、连续续行、Unicode、视频导入固定、移除默认 title、1440px/390px 布局和表格内横向滚动。新增四列真实鼠标拖动、对应文字空间变化、双击恢复、键盘调宽/上下限、拖出表头、取消及失去捕获、字幕/草稿/选中行/video 节点/播放位置保留；同页列表往返保留列宽，刷新恢复默认。没有写入开发数据库或修改账号。
- 最终截图目录位于系统 TMPDIR 的 `cuerelay-cue-table-bCZtl7`；已查看桌面和窄屏滚动截图。
- `git diff --check`、浏览器脚本语法检查通过；扫描 81 个 TS/TSX 文件，无相对 import 环。

后续原生提示修正已执行 `npm run build`（含类型检查）及同一 Chrome 回归：按钮 hover 命中、input 不可见、鼠标打开后空选取消、Enter 打开并选视频、按钮/input 固定禁用，以及原列宽/CPS/历史检查全部通过。该次截图目录为系统 TMPDIR 的 `cuerelay-cue-table-FU3sjb`。本次提示修正未重跑单元测试；上述 208 项为列宽实现时的结果。

运行需要 Chrome、FFmpeg，以及 5173 上的前端（可用 CUE_TABLE_URL 指定其他地址）。此脚本使用 UI 测试夹具，不覆盖真实登录/后端转换或生产部署；本轮无后端修改，未执行后端测试，未实测触屏或 Safari/Firefox。CPS 只是显示统计，不新增速度限制或设置项。
