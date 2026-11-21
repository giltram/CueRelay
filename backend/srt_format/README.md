# srt_format

纯格式模块，无 Django、ORM、文件、网络或浏览器依赖。公开接口为 `parse_srt(source: str) -> v2 document`、`serialize_srt(document: dict) -> str`、`SrtError.issue`。依赖向下为 `srt_format → {ass_format 公共接口, message_contracts, stdlib}`，ASS 模块不依赖 SRT。没有新库、持久字段或编辑器。

`blocks.py` 拥有块结构、原始毫秒时间及源位置；`text.py` 拥有内联标签/实体与 ASS 子集的双向转换；`codec.py` 组合默认文档、时间量化及全结果验证。`errors.py` 提供 code/reason/params 和可用的物理 `line`、一基 `block`（不是文件内序号）。纯格式回归在 `tests.py`，HTTP 在 `http_api/test_srt.py`，持久化在 `projects/test_srt.py`，实际浏览器在 `frontend/regression/srt.spec.mjs`。

## 实际支持子集

SRT 没有统一严格标准，下列是 CueRelay 的明确产品边界，不是对所有播放器的兼容承诺。

| 内容 | 规则 |
| --- | --- |
| 编码 | 文件数据层严格 UTF-8 解码，可含文件开头 BOM；不猜测编码，不替换非法字节。HTTP 接收已解码 Unicode，拒绝孤立 surrogate。其他编码请保留原件并另存 UTF-8。 |
| 块 | 独占一行的 ASCII 非负整数序号、时间行、零行或多行正文；块间至少一条真正空行。支持 LF/CRLF、末尾无空行。仅空白文件指空字符串/BOM/空行；空格/Tab 不视为可丢弃分隔符。CR-only、同一行序号+时间、无序号、时间后坐标及 VTT 等不支持。 |
| 序号/顺序 | 序号可为 0，可跳号、重复、前导零；不当作身份。按文件块顺序导入，允许乱序、重叠和零时长；不自动排序。 |
| 时间 | 必须 `HH:MM:SS,mmm --> HH:MM:SS,mmm`，箭头两侧至少一个 ASCII 空格/Tab，小时恰两位，分秒 00–59。先检查原始 `0 ≤ start ≤ end ≤ 35999990ms`，再按最近 10ms 舍入，5ms 向上。每边界误差 ≤5ms，时长误差 ≤10ms；1,234→1,230、1,235→1,240，1,231–1,234→1,230–1,230。单调量化不逆转边界，可能合并相邻时间或使短行变零；不拉长、不裁剪、不升全系统精度。原本倒序的短行不能借舍入变有效。 |
| 空文档/正文 | 纯格式空文件得到零 cues，空正文与零时长均保留。现有本地 UI 的空文档补一条空行规则仍适用，项目初始化不补行。 |
| 正文 | 保留中文/emoji、首尾空格和真正非空正文行。物理换行变为 `\N`。独立时间轴形状的正文行拒绝，避免缺失分隔符被吞作文字；坏块/尾随垃圾不跳过。 |
| 基础标签 | 大小写不敏感、无属性且正确配对/嵌套的 `b/i/u/s` 转换为 ASS 的 `\b/\i/\u/\s` 0/1。同种嵌套恢复外层状态。未知/损坏标签（包括 font、br、注释及带属性标签）整份拒绝，不剥除或执行。 |
| 实体/字面文字 | 只解码带分号的 stdlib HTML5 具名实体与有效十进制/十六进制 Unicode 数值实体一次。未知具名实体、无效码点及解码后控制字符明确拒绝。未带分号的 `&amp` 等保留为普通文字。标签识别先于实体解码，所以 `&lt;b&gt;` 是字面 `<b>`，`&amp;amp;` 是字面 `&amp;`。普通数学尖括号及 `&` 保留；不使用 innerHTML。 |
| 无法表示的字面文字 | 当前 ASS 子集不能无损存普通 `{}` 或字面反斜线（即使是看似合法的 `\N` 或 `{\b1}`）。包括实体解码后的这些字符，均定位整份拒绝，不变成 ASS 指令、不换全角字符、不扩展模型。字面标签请用实体表达。 |
| 预算 | SRT 输入/输出各 ≤1MiB、最多 5000 cues、转换后每条 ASS 正文 ≤16384 字符；完整统一文档还必须通过现有 ASS 源模板/序列化预算。大小增大可能使本来较小的输入被拒绝。编码/整文档预算错误未必能定位某个块。 |

## 统一模型与默认值

导入调用 `ass_format.empty_document()`，使用相同的 Default 样式、640×360、ScaledBorderAndShadow=yes 和脚本元数据。新 cues 经整份 ASS 序列化/解析，生成含所有字幕的 ASS source 和合法原始行锚点；返回的是统一 schema v2，不保留可写的第二份 SRT 文档。

项目创建继续提交 `source`（此处为已转换并验证的 ASS），沿用原模板/脚本覆盖初始化规则。组织模板只能通过既有显式操作追加。已有项目仍不允许文件替换，SRT 不覆盖其样式、source 或 revision。导入失败不返回部分文档；成功后客户端才建立新历史基线，失败不触及历史、选择或草稿。

## 导出规则与损失

先复用 `serialize_ass` 验证统一文档有效性，再只读输出 `document.cues` 的原事件顺序，连续编号 1…N，时间固定两位小时/三位毫秒，LF、每块末尾空行、UTF-8 无 BOM。保留空正文、零时长；空文档输出空字符串。ASS Comment、脚本元数据及字体/颜色/字号/位置/边距/图层等不进入 SRT；原 ASS 文档完全不变，仍可保存/导出。

逐字符/已知 token 转换 ASS 正文，结合行样式的初始 b/i/u/s 与正文 override 生成有效、规范嵌套的标签。普通 `<`/`>`/`&` 编码为实体，绝不粗暴删除花括号；不向 SRT 泄漏 ASS 指令。`\N` 与软换行 `\n` 均变物理换行（后者失去 WrapStyle 条件语义），`\h` 变 U+00A0。回读 NBSP 成普通 Unicode 不换行空格，标签边界也可规范化；只保证此支持子集的文字/基础格式语义，不能宣称 ASS token 或文件字节无损。

可见正文有首尾或连续换行时，SRT 分块不能无歧义保留，定位到导出块报错，建议使用 ASS；不 trim/压缩换行。时间轴形状的独立正文行同样拒绝。字幕后续编辑扩大文件或实体编码膨胀可触及 SRT 输出预算。

普通导出复用现有 QC。SRT 在同一面板一次说明损失并「继续导出 SRT」，无额外设置/弹窗；统一文档 error 仍阻止，warning 可继续，服务失败由最终序列化器校验。下载只包含已应用内存字幕（含未保存正文），不提交原始时间草稿、不保存项目。命名沿用项目名/本地 cuerelay 加下载本机时间，扩展名 `.srt`、MIME `text/plain; charset=utf-8`。离页/恢复副本备份永远使用原 ASS 路径，不跟随上次选定格式。

## 研究依据

- [Library of Congress 格式说明](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml)：文档/编码及 HTML 格式支持有实现差异，常见块结构为序号、毫秒时间、多行正文、空行；不将其 32 字符描述当作内部强制长度。
- [已安装 pysubs2 1.8.1 SubRip 源码](https://github.com/tkarabela/pysubs2/blob/1.8.1/pysubs2/formats/subrip.py)：按匹配时间行搜集、丢弃前导垃圾、strip 正文、默认删除未知 HTML，输出不保留粗体且压缩换行。已实际运行反例核实；其 `get_text_events()` 只滤 Comment/绘图，保留空/零时长，早期判断已纠正。故复用现有 ASS 能力，新增小型严格 SRT 边界，不引入新依赖。
- [FFmpeg htmlsubtitles.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/htmlsubtitles.c)：支持 b/i/u/s，另有 font/br 与丢弃未知标签/部分花括号的宽松处理；仅作成熟实现对照，不复制容错策略。CueRelay 使用自写样本和明确期望检验差异，不从公开说明推导“统一标准”。

命令和本次实际执行结果见 [实施记录](../../docs/plans/srt.md)；测试总入口见 [docs/testing.md](../../docs/testing.md)。
