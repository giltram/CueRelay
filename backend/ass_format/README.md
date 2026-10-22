# ass_format

纯 Python 格式边界，仅依赖标准库和 pysubs2；不导入 Django、HTTP、ORM，不读写文件、不访问网络。测试夹具由测试调用方读取。

## 公共接口

- `parse_ass(source: str) -> document`：完整预检；失败抛 `AssError`，`issue` 含 code/message 和可获得的源行号。调用者负责 UTF-8 字节解码。
- `serialize_ass(document: dict) -> str`：校验完整快照，输出 UTF-8 可编码的 ASS 文本。再次预检输出，失败不产出部分文档。
- `empty_document() -> document`：空文档与基础默认样式，客户端不自行生成 ASS。

`document = {source, styles, cues}`；`styles` 为可引用样式名数组，不能通过此 DTO 修改定义。`source` 是原始文本模板，每次转换都重新预检，无持久存储身份。`cues` 仅包含 Dialogue，字段为 `{id, start_ms, end_ms, text, style}`。时间是非负整数毫秒、10ms 网格且 `start < end`，上限 35999990ms。文本使用 ASS 原始转义，不转换 HTML。

源 Dialogue ID 为 `source-<原始零基行号>`，绑定原始记录锚点；不因显示排序改变事件顺序。新行 ID 必须以 `new-` 开头且唯一；追加在 Events section 结尾。省略源行表示删除 Dialogue；Comment、其他受支持元数据、样式、注释及原始顺序保留。导入后续编辑期间不能重新把导出稿作为模板而继续沿用旧 ID；要通过重新导入整体得到新 DTO。

## 保留策略

pysubs2 1.8.1 的裸序列化会丢分号注释，读取器忽略文件 Format。因此 `codec.py` 按声明 Format 映射字段，将规范字段顺序提供给 pysubs2 做解析检查；导出通过原始行锚点替换 Start/End/Text/Style，其余保留。不承担任意 ASS 解析，不使用通用 AST 或 opaque 未知记录作为绕过路径。

允许 Script Info、V4+ Styles、Events 和仅作文本保留的 Aegisub Project Garbage；其中 URL/路径绝不读取。`Text` 必须最后一个字段，其他标准字段可重排。未知 section/字段/标签、附件、SSA、非空 Effect 等整份拒绝；Comment 同样预检。1MiB / 5000 事件 / 16384 字符是本验证台边界，不代表完成全格式恶意输入矩阵。

原始字节由页面 `File` 独立保留，不能拿本模块编辑导出来替代原件。导出换行规范为 LF；语义保留与原件字节保留是两个契约。

测试：`python manage.py test ass_format`；样本在 `fixtures/`。HTTP 的 JSON 边界见 `http_api/ass_views.py` 与契约测试，测试不建立数据库。
