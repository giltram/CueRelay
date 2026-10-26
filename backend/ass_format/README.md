# ass_format

纯 Python 格式边界，仅依赖标准库和 pysubs2；不导入 Django、HTTP、ORM，不读写文件、不访问网络。测试夹具由测试调用方读取。

## 公共接口

- `parse_ass(source: str) -> document`：完整预检；失败抛 `AssError`，`issue` 含 code/message 和可获得的源行号。调用者负责 UTF-8 字节解码。
- `serialize_ass(document: dict) -> str`：校验完整快照，输出 UTF-8 可编码的 ASS 文本。再次预检输出，失败不产出部分文档。
- `empty_document() -> document`：空文档与基础默认样式，客户端不自行生成 ASS。

`document = {schema_version: 2, source, script, styles, cues}`。`script` 包含 `play_res_x` / `play_res_y` / `scaled_border_and_shadow`；缺失的原始值用 null 保留，不根据视频推断。其他脚本元数据继续由 source 保留。

`styles` 包含 `{id, name, fields, source_name, origin}`。id 是导入时生成并持久保留的 UUID；name 是唯一 ASS 导出名称；fields 使用标准 ASS 字段名称和值字符串（不含 Name）。source_name 绑定原始样式记录与 Comment 引用，复制/新建为 null；origin 是可选的 `{template_id, revision}` 快照说明，不代表继承。

`cues` 仅包含 Dialogue，基础字段为 `{id, start_ms, end_ms, text, style_id}`，拆分行可有 source_id。时间是非负整数毫秒、10ms 网格且 `start < end`，上限 35999990ms。文本使用 ASS 原始转义，不转换 HTML。没有同时可写的 style 名称字段。

源 Dialogue ID 为 `source-<原始零基行号>`，绑定原始记录锚点；新行以 `new-` 开头且唯一，追加在 Events section 结尾。省略源行表示删除 Dialogue。样式/脚本覆盖时不重新导入导出稿，因此 Cue ID、source_id 和辅助字段仍绑定原始模板。ASS 本身不保存内部 UUID；重新导入是一个新文档，产生新样式身份。

`apply_style_operation` 提供不可变、整批成功或失败的 create/update/copy/delete/batch/assign/script 操作，生成新 ID、校验完整最终输出。`import_style` / `import_style_snapshots` 接收调用层已鉴权并检查版本的模板快照；不读取数据库。`style_usage` 返回 Dialogue 与 Comment 的分开计数。使用中或最后一个样式不可删除。字段验证在 styles.py，操作在 style_operations.py；迁移专用 upgrade_legacy_document 在 migration.py，普通 HTTP 写入拒绝 v1。

适配规则：copy 原样复制；scale 仅接受完整 PlayRes、相同宽高比且双方 ScaledBorderAndShadow=yes。字号/字距/描边/阴影/样式边距乘目标 Y / 参考 Y；Decimal 运算，边距 half-up 到整数，其他几何属性 half-up 到六位小数。颜色/alpha、布尔、ScaleX/Y 百分比、角度、对齐与 Encoding 不变；字幕行边距覆写不变。其他情况拒绝 scale，允许显式 copy 后人工调整。脚本设置修改本身不缩放既有样式。

边界：每文档 1–1000 个样式、每组织 1000 模板，同时受 1MiB ASS 导出限制。名称/字体 1–100 字符，无逗号/控制字符/首尾空白；颜色为 &HAABBGGRR；PlayRes 为 1–32768 整数。重复或非法 PlayRes 保护性拒绝，大小写变体也检测重复。

数值有限性和 ±10000 大小比较使用精确、无上下文的 Decimal.copy_abs，超出范围的极端指数或略超边界的数字必须转换为 AssError，不能产生 Overflow 或被精度舍入放行。历史 v1 快照兼容边界由 `fixtures/legacy-v1/` 与 `test_migration.py` 固定，迁移仍拒绝非规范/重复 PlayRes 及超长名称，不静默修正 source。

## 保留策略

pysubs2 1.8.1 的裸序列化会丢分号注释，读取器忽略文件 Format。因此 `codec.py` 按声明 Format 映射字段，将规范字段顺序提供给 pysubs2 做解析检查；导出通过原始行锚点覆盖 Start/End/Text/Style、样式记录和三个结构化脚本设置，其余保留。Comment 的 Style 随绑定样式改名同步。不承担任意 ASS 解析，不使用通用 AST 或 opaque 未知记录作为绕过路径。

允许 Script Info、V4+ Styles、Events 和仅作文本保留的 Aegisub Project Garbage；其中 URL/路径绝不读取。`Text` 必须最后一个字段，其他标准字段可重排。未知 section/字段/标签、附件、SSA、非空 Effect 等整份拒绝；Comment 同样预检。1MiB / 5000 事件 / 16384 字符是本验证台边界，不代表完成全格式恶意输入矩阵。

本模块不保存原始字节文件，不能拿编辑导出来替代原件。导出换行规范为 LF；语义保留与原件字节保留是两个契约。

测试：`python manage.py test ass_format`；样本在 `fixtures/`。HTTP 的 JSON 边界见 `http_api/ass_views.py` 与契约测试，测试不建立数据库。

## 拆分

公开纯函数 `split_document(document, cue_id, mode, position)` 在 `splitting.py`，返回 `{document, first_id, second_id}`，不修改输入。playhead position 为 10ms 网格毫秒，只拆严格空文本；text position 为浏览器 UTF-16 光标偏移，只拆普通文本，按 Unicode 字符比例舍入时间，拒绝端点、空白侧、标签/转义、代理对和常见组合字符内部位置。前后均复用 serialize_ass 验证全部限制。

Cue 可额外包含 source_id：仅 new 行可引用模板内原始 Dialogue 的 ID，复用 Layer/Name/Margins 等未暴露元数据。两条拆分结果用新 UUID，删除旧身份；重复拆分保留同一 source_id。原始模板、Comment 和其他原行保持，拆分新行与原有 new 行一样追加到 Events 末尾。拆分保留 style_id，不改变样式定义。

格式/拆分回归：`test_splitting.py`；保存与协作限制见 [编辑操作契约](../../docs/editing-operations.md)。
