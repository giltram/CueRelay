# English terminology

Checked 2026-11-15 against the versioned Aegisub documentation below. These references are for short functional names and facts; the CueRelay handbook and explanatory prose are written for CueRelay. No upstream translation catalogs, help chapters, icons or source code were copied for this task. Existing Aegisub code/parameter references and notices remain in `licenses/texts/aegisub.txt`.

Sources:

- [Aegisub 3.2 English command table](https://aegi.vmoe.info/docs/3.2/Commands/en_US/) (versioned documentation mirror, including command identities).
- [Aegisub 3.0 subtitle editing](https://aeg-dev.github.io/AegiSite/docs/3.0/Editing_Subtitles/) (upstream documentation repository site, grid menu labels).
- [Aegisub 3.0 styles](https://aeg-dev.github.io/AegiSite/docs/3.0/Styles/) (field names and styles manager).

| CueRelay feature | Adopted English | Reference / distinction |
| --- | --- | --- |
| 提交并下一条 | Commit and move to next line | 3.2 `audio/commit/next`; CueRelay creates an empty row when committing the last row |
| 试听选区 | Play audio selection | 3.2 `audio/play/selection`; independent audio, picture stays still |
| 入点前 / 出点后试听 | Play 500 ms before selection / Play 500 ms after selection | 3.2 `audio/play/selection/before`, `/after`; clipped to local media bounds |
| 选区两端试听 | Play first 500 ms of selection / Play last 500 ms of selection | 3.2 `audio/play/selection/begin`, `/end` |
| 普通前后插入 | Insert (before) / Insert (after) | 3.0 grid menu; CueRelay uses 3s shortened to boundaries and permits zero-duration insertion, rather than Aegisub's documented 5s |
| 按视频时间插入 | Insert at video time (before) / Insert at video time (after) | 3.0 grid menu; requires a readable actual frame |
| 重复字幕行 | Duplicate Lines | 3.2 `edit/line/duplicate` |
| 帧前 / 帧后分割 | Split lines before current frame / Split lines after current frame | 3.2 `edit/line/split/before`, `/after`; CueRelay's out-of-interval copy and 10ms constraints are described in its handbook |
| 剪切 / 复制 / 粘贴 / 删除行 | Cut Lines / Copy Lines / Paste Lines / Delete Lines | 3.2 `edit/line/{cut,copy,paste,delete}`; CueRelay validates its supported ASS subset |
| 选择字段粘贴覆盖 | Paste Lines Over | 3.2 `edit/line/paste/over`; CueRelay exposes only Start, End, Style and Text |
| 文本光标拆分 | Split at cursor (estimate times) | 3.2 `edit/line/split/estimate`; CueRelay additionally requires plain text without tags/escapes and valid Unicode boundaries |
| 样式管理 | Styles Manager | 3.2 `tool/style/manager`; organization templates/project snapshots are not Aegisub storage files |
| 脚本设置 | Script Properties | 3.0 styles documentation / Script Properties link; CueRelay exposes only its supported subset |
| 样式外观 | Font, Style name, Primary/Secondary/Outline/Shadow color, Spacing, Rotation, Alignment, Opaque box, Encoding | 3.0 styles; ASS field IDs/ABGR wire values remain unchanged |
| 设置入点 / 出点为播放头 | Set start to video position / Set end to video position | Deliberately distinct from 3.2 `time/snap/*_video`: CueRelay changes the active line's draft at video position, not every selected subtitle's applied frame time |
| 播放头拆分空行 | Split empty line at video position | CueRelay-specific behavior; no borrowed name suggesting text duplication |

Desktop mnemonic markers (`&`, underscores, trailing dialog ellipses) are not copied into web labels. Shortcut identities and physical bindings remain owned by `shared/timing-shortcuts.json`; translation resources own only display names. A terminology change must update English resources and the handbook together; do not rename stable action IDs.
