# ass_format

纯 Python 格式边界，仅依赖标准库和 pysubs2；不导入 Django、HTTP、ORM，不读写文件、不访问网络。测试夹具由测试调用方读取。

## 公共接口

- `parse_ass(source: str) -> document`：完整预检，并复用序列化器检查未编辑快照的规范化输出（包括大小预算）；成功返回的文档可直接导出。失败抛 `AssError`，`issue` 含 code/message 和可获得的源行号。调用者负责 UTF-8 字节解码。
- `serialize_ass(document: dict) -> str`：校验完整快照，输出 UTF-8 可编码的 ASS 文本。再次预检输出，失败不产出部分文档。
- `empty_document() -> document`：空文档与基础默认样式，客户端不自行生成 ASS。
- `inspect_document(document) -> issues`：只读复用 `_document_layout` / `_cue_record`，每条字幕返回首个致命错误及可获得的 cue_id；有效行全部通过后复用完整 serialize_ass 检查输出限制。每项包含原 code/message/可选 line 和 type（invalid-time/missing-style/unsupported-ass）。文档级错误没有 cue_id；空列表保证当前快照可序列化。实现位于 inspection.py，不导入 Django、不修改输入；HTTP 薄适配为 POST `/api/ass/inspect`，请求仅含 document，200 返回检查问题，非法请求/超限沿用 400/413。检查不是保存或修复。

`document = {schema_version: 2, source, script, styles, cues}`。`script` 包含 `play_res_x` / `play_res_y` / `scaled_border_and_shadow`；缺失的原始值用 null 保留，不根据视频推断。其他脚本元数据继续由 source 保留。

`styles` 包含 `{id, name, fields, source_name, origin}`。id 是导入时生成并持久保留的 UUID；name 是唯一 ASS 导出名称；fields 使用标准 ASS 字段名称和值字符串（不含 Name）。source_name 绑定原始样式记录与 Comment 引用，复制/新建为 null；origin 是可选的 `{template_id, revision}` 快照说明，不代表继承。

`cues` 仅包含 Dialogue，基础字段为 `{id, start_ms, end_ms, text, style_id}`，拆分行可有 source_id，剪贴板插入的新行可有 ass_fields（Layer/Name/MarginL/MarginR/MarginV），只用于保留隐藏元数据。时间是非负整数毫秒、10ms 网格且 `start < end`，上限 35999990ms。文本使用 ASS 原始转义，不转换 HTML。没有同时可写的 style 名称字段。

源 Dialogue ID 为 `source-<原始零基行号>`，绑定原始记录锚点；新行以 `new-` 开头且唯一，文档 cues 数组决定 Dialogue 输出顺序（依次填原槽位，多出部分置于 Events 末尾），与元数据锚点分开。省略源行表示删除 Dialogue。样式/脚本覆盖时不重新导入导出稿，因此 Cue ID、source_id 和辅助字段仍绑定原始模板。ASS 本身不保存内部 UUID；重新导入是一个新文档，产生新样式身份。

`apply_style_operation` 提供不可变、整批成功或失败的 create/update/copy/delete/batch/assign/script 操作，生成新 ID、校验完整最终输出。`import_style` / `import_style_snapshots` 接收调用层已鉴权并检查版本的模板快照；不读取数据库。`style_usage` 返回 Dialogue 与 Comment 的分开计数。使用中或最后一个样式不可删除。字段验证在 styles.py，操作在 style_operations.py；迁移专用 upgrade_legacy_document 在 migration.py，普通 HTTP 写入拒绝 v1。

适配规则：copy 原样复制；scale 仅接受完整 PlayRes、相同宽高比且双方 ScaledBorderAndShadow=yes。字号/字距/描边/阴影/样式边距乘目标 Y / 参考 Y；Decimal 运算，边距 half-up 到整数，其他几何属性 half-up 到六位小数。颜色/alpha、布尔、ScaleX/Y 百分比、角度、对齐与 Encoding 不变；字幕行边距覆写不变。其他情况拒绝 scale，允许显式 copy 后人工调整。脚本设置修改本身不缩放既有样式。

边界：每文档 1–1000 个样式、每组织 1000 模板，同时受 1MiB ASS 导出限制。名称/字体 1–100 字符，无逗号/控制字符/首尾空白；颜色为 &HAABBGGRR；PlayRes 为 1–32768 整数。重复或非法 PlayRes 保护性拒绝，大小写变体也检测重复。

ASS 样式名额外拒绝以 `*` 开头：libass 会去掉前导星号，不能让不同内部身份在渲染时合并。保留名 `Default` 必须精确使用此大小写，拒绝 `default` / `DEFAULT` 等变体，以免引擎引用其他 Default；普通 `foo` / `Foo` 仍可作为不同样式。这两项身份限制不施加于字体名。创建、改名、复制、模板导入和直接文档导出共享最终校验，不静默修名或合并。

导入按字段处理原始词法：Name/Fontname 仅移除引擎确实跳过的前导 ASCII 空格/Tab，拒绝任何尾部空白；其他样式字段仅移除前后 ASCII 空格/Tab，再调用共享校验。非 ASCII 边界空白（如 U+00A0/U+2003/U+3000）不能先被 `strip()` 丢弃后再验证；错误包含字段名和源行号。正文及纯保留元数据中的这些 Unicode 字符不受此语法限制。

样式小数字段先校验 ASCII 十进制词法：可有正负号、小数点和 e/E 指数（如 `+28`、`28.`、`.5`、`2.8e1`），拒绝下划线、Unicode 数字和非数值字面量。数值有限性和 ±10000 大小比较使用精确、无上下文的 Decimal.copy_abs，超出范围的极端指数或略超边界的数字必须转换为 AssError，不能产生 Overflow 或被精度舍入放行。历史 v1 快照兼容边界由 `fixtures/legacy-v1/` 与 `test_migration.py` 固定，迁移仍拒绝非规范/重复 PlayRes 及超长名称，不静默修正 source。

## 保留策略

pysubs2 1.8.1 的裸序列化会丢分号注释，读取器忽略文件 Format。因此 `codec.py` 按声明 Format 映射字段，将规范字段顺序提供给 pysubs2 做解析检查；导出通过原始行锚点覆盖 Start/End/Text/Style、样式记录和三个结构化脚本设置，其余保留。Comment 的 Style 随绑定样式改名同步。不承担任意 ASS 解析，不使用通用 AST 或 opaque 未知记录作为绕过路径。

允许 Script Info、V4+ Styles、Events 和仅作文本保留的 Aegisub Project Garbage；其中 URL/路径绝不读取。`Text` 必须最后一个字段，其他标准字段可重排。未知 section、样式/事件 Format 字段、标签、附件、SSA、非空 Effect 等整份拒绝；Comment 同样预检。1MiB / 5000 事件（含 Comment）/ 16384 字符是本验证台边界，不代表完成全格式恶意输入矩阵。

## 文件兼容性契约

- `ScriptType: v4.00+` 必需。三个结构化设置的键必须精确为 `PlayResX`、`PlayResY`、`ScaledBorderAndShadow`；键前可有 ASCII 空格/Tab，键与冒号之间不能有额外空白。值周围仅规范化 ASCII 空格/Tab，非 ASCII 边界空白拒绝，不能让原本无效的键/值在导出后开始影响渲染；大小写变体重复检查保留。缺失值保持 null，不根据视频推断。其他已校验语法 token（如 Format 字段、时间、Layer/Margin、空 Effect）同样只按 ASCII 空格/Tab 处理边界空白。
- 其他 Script Info 键（如 Title、Timer、WrapStyle、YCbCr Matrix、自定义元数据）原文保留，**不校验其完整合法性、重复值或解释**。保留不等于已验证这些设置的渲染语义，不宣称任意元数据均兼容。非法值暂不自动修正。
- Dialogue 可编辑、Comment 保护性保留。二者引用样式都允许引擎正确跳过的前导 ASCII 空格/Tab；尾部空白或非 ASCII 前导空白拒绝。libass 不会去掉引用尾部空白，而会静默回退 Default，故不能用 `.strip()` 规范化并声称保真。缺失引用在收集全部定义后检查，错误含样式名和事件源行号，支持 Styles 位于 Events 之后。
- `h:mm:ss.cc`、0–35999990ms、10ms 网格且入点早于出点；允许时间重叠、同层重叠及非时间顺序。保留 Layer、Name、MarginL/R/V 与事件顺序，不自行按时间排序。
- 文本按原始 ASS 字符串保留，支持 Unicode、空正文、首尾空格、逗号/引号/普通括号；仅支持 `\N`、`\n`、`\h` 转义及 `\b0/1`、`\i0/1`、`\u0/1`、`\s0/1` override 组合。其他转义、标签、绘图、动画、卡拉 OK、任意花括号或控制字符在接受前整份拒绝。libass 自身会忽略文件文本末尾 ASCII 空白，DTO/导出仍保留这些字符。
- 文件入口严格 UTF-8（可含 BOM），支持 LF/CRLF/CR 及混合换行；非法字节在请求前拒绝。输出统一 LF、补末尾换行，可去掉 BOM。规范化输出超限时即拒绝导入，不先返回不可导出的文档。

HTTP 导入失败返回 422 与 issues，不返回部分文档；项目初始化不会持久化半成品。本地 UI 只在成功后替换文档；导出失败不返回部分 ASS。文件原件仍需保留：这里不提供字节级归档。未来编辑增大文档仍可能触及输出限制。

产品例外：本地工作区导入无 Dialogue 文档时按既有约定补一条空行，项目打开不补行；剪贴板的空行过滤/未知样式回退是独立契约，不属于文件导入语义往返。预览字体替代及跨播放器视觉差异见 [预览 README](../../frontend/src/ass-preview/README.md)。

2026-11-11 校验收紧后，历史上被放行的非规范脚本键/非 ASCII 语法空白、星号或 Default 大小写变体样式、Python 数字、尾空白名称/字体或引用快照会明确报错，不自动改写。部署前可用既有只读 `check_style_migration` 扫描 v1/v2 项目，在原件/备份上人工处理并验证；无需新数据模型或迁移。

本模块不保存原始字节文件，不能拿编辑导出来替代原件。导出换行规范为 LF；语义保留与原件字节保留是两个契约。

测试：`python manage.py test ass_format`；样本在 `fixtures/`。HTTP 的 JSON 边界见 `http_api/ass_views.py` 与契约测试，测试不建立数据库。

兼容性语料与手写语义期望见 [fixtures/compatibility](fixtures/compatibility/README.md)，`test_compatibility.py` 覆盖有效/非法文件、词法/空白/编码换行变体、资源边界及样式操作。`http_api.test_ass_compatibility` 验证真实 Import → Export → Import；`projects.test_ass_compatibility` 使用 PostgreSQL 验证创建/读取/编辑保存/导出/再建项目及失败原子性。`frontend/src/project-data/ass-api.test.ts` 验证严格字节解码；在 frontend 运行 `npm run test:ass-compatibility` 使用真实安装的 JASSUB WASM 检查审计反例、数字语法及语料的样式/事件/字形图块往返，不依赖同一个 Parser 自证正确。执行结果及审计 F4 修正见 [验证记录](../../docs/experiments/ass-compatibility.md)。

复核回归在 `test_follow_up.py`：结构化键/值的非 ASCII 空白、每个样式字段在标准/重排 Format 中的原始空白、名称/字体尾空白、Default 保留名的全部样式写入口，以及合法 ASCII 空白和普通大小写名称的对照。WASM 同时比较每条 Cue 的模型样式名称/字号/字体与实际引擎引用，避免只凭往返图像相同漏掉身份冲突；受影响事件在 2s 和 3.6s 分别验证。

检查回归：`test_inspection.py` / `http_api/test_qc.py`，验证每行定位、与导出相同的标签/时间/样式规则、输出超限、空轴及 5000 事件。`AssError.category` 仅为纯校验的分类元数据，既有 issue code/导出错误响应不变。

## 拆分

公开纯函数 `split_document(document, cue_id, mode, position)` 在 `splitting.py`，返回 `{document, first_id, second_id}`，不修改输入。playhead position 为 10ms 网格毫秒，只拆严格空文本；text position 为浏览器 UTF-16 光标偏移，只拆普通文本，按 Unicode 字符比例舍入时间，拒绝端点、空白侧、标签/转义、代理对和常见组合字符内部位置。前后均复用 serialize_ass 验证全部限制。

Cue 可额外包含 source_id：仅 new 行可引用模板内原始 Dialogue 的 ID，复用 Layer/Name/Margins 等未暴露元数据。两条拆分结果用新 UUID，删除旧身份；重复拆分保留同一 source_id。原始模板、Comment 和其他原行保持，拆分结果位于原 cue 的文档位置，导出同样按 cues 顺序输出。拆分保留 style_id，不改变样式定义。

格式/拆分回归：`test_splitting.py`；保存与协作限制见 [编辑操作契约](../../docs/editing-operations.md)。

## 字幕行剪贴板

`copy_lines(document, ids) -> str` / `paste_lines(document, text, active_id, ids, fields=None) -> {document, selected_ids}` 在 clipboard.py；标准 ASS Dialogue / 普通文本互通，复用 codec 验证，插入时以 new 行可选 ass_fields 保留五项有界字符串，不替换 source/styles/script；覆盖仅修改四项结构化字段并保留目标隐藏元数据。新行和完整输出继续受 1MiB / 5000 事件限制。无网络/存储依赖，格式与顺序回归在 test_clipboard.py。完整契约见 [字幕行操作](../../docs/subtitle-line-operations.md)。
