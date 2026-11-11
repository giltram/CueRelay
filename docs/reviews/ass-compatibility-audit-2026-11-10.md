# ASS 兼容性审计：第一阶段

审计日期：2026-11-10。归档日期：2026-11-11。

本报告记录用户要求的第一阶段只读审计，不代表第二阶段回归语料建设或第三阶段修复已经完成。审计期间未修改实现、测试或文档；本次归档仅新增本报告。以下测试结果来自审计当日的实际运行，归档时没有重新运行测试。

这是有日期的审计快照，不作为另一份长期维护的支持规范。当前格式契约入口仍是 [ass_format README](../../backend/ass_format/README.md)，样式产品契约见 [样式管理](../style-management.md)。后续修复应同步更新这些权威文档。

## 1. 结论与范围

现有原始行保留适配器及模块边界适合继续完善受限 ASS 支持，无需重写 Parser 或引入大型解析框架。但确认了五个兼容性问题，不能认定所有被接受的输入都能保持编辑、导出及渲染语义一致。

| 编号 | 优先级 | 已确认问题 |
| --- | --- | --- |
| F1 | P1 | 非规范 PlayRes 键被静默规范化，未编辑导出即可改变字幕尺寸与位置。 |
| F2 | P1 | `Default` 与 `*Default` 被内部模型视为独立样式，实际渲染时发生名称冲突。 |
| F3 | P2 | 样式数字接受 Python 特有语法，后端适配和 libass 对数值解释不同。 |
| F4 | P2 | 带首尾空白的样式引用被误报为不存在，且错误缺少源行号。 |
| F5 | P2 | 恰好达到大小上限的文件可导入，却可能未经编辑就无法导出。 |

阅读了根 `AGENTS.md`、[架构入口](../architecture.md)、相关规划和样式契约，包括 `docs/plans/ass-preview.md`、`docs/plans/style-management.md`、`docs/planning-review.md`。沿格式、HTTP、项目保存、编辑器、样式管理和预览调用链检查了实际实现及相关测试。

本次不是完整 ASS 标准验证、所有输入穷举或所有播放器兼容认证；没有运行 PostgreSQL 项目集成测试、完整浏览器回归或全平台视觉验收。没有修改实时协作、WebSocket、编辑锁、保存并发、用户组织或无关 UI。

## 2. 实现位置与数据流

| 模块 | 责任与主要入口 |
| --- | --- |
| `backend/ass_format/codec.py` | `parse_ass`、`serialize_ass`、`empty_document`；原始行预检、Format 映射、事件校验、模板锚点覆盖。 |
| `backend/ass_format/styles.py` | 样式字段、名称、脚本设置校验及受限等比适配。 |
| `backend/ass_format/style_operations.py` | 样式创建、修改、复制、删除、分配、脚本修改及模板快照导入。 |
| `backend/ass_format/{inspection,splitting,clipboard,migration}.py` | 复用格式边界的 QC、拆分、剪贴板及历史升级；不是另一套文件 Parser。 |
| `backend/http_api/ass_views.py` | 无状态 JSON 转换适配；格式错误返回 422，请求契约错误返回 400，请求超限返回 413。 |
| `backend/projects/{services,style_services,document_styles}.py` | 项目创建、完整快照保存及具名样式操作，复用纯格式校验。 |
| `frontend/src/contracts/subtitles.ts` | v2 文档与 Cue 类型。 |
| `frontend/src/project-data/ass-api.ts` | 文件大小及严格 UTF-8 解码、导入/导出 HTTP 调用、错误行号展示。 |
| `frontend/src/workspace-ui/EditorWorkbench.tsx` | 组合导入、内存编辑、保存和导出；文档与历史由现有编辑状态机制持有。 |
| `frontend/src/ass-preview/` | 注入同一后端序列化器，调度 JASSUB/libass Track；不持有第二份可写字幕模型。 |

数据流：

```text
File → 严格 UTF-8 解码 → /api/ass/import → parse_ass → v2 document
                                                       ↓
                                             编辑器内存文档
                                               ↙       ↘
                             项目校验、快照保存         /api/ass/export
                                                            ↓
                                                      serialize_ass
                                                       ↙         ↘
                                                  下载 ASS      JASSUB 预览
```

预览可以投影当前行的有效时间草稿；保存与导出仍使用已应用时间。该投影不修改权威文档。

v2 文档为 `{schema_version, source, script, styles, cues}`。`source` 保留原始模板和辅助元数据；`script` 结构化三项设置；`styles` 持有 UUID、名称、字段、原始名称绑定及可选模板来源；`cues` 仅暴露 Dialogue，以 `style_id` 引用样式。内部 UUID 不写入 ASS，重新导入产生新样式身份，不应将 UUID 相等作为文件往返语义要求。

Comment 不进入可编辑 Cue 数组，但会预检、保留并随关联样式改名更新。源行 ID/source_id 绑定隐藏事件元数据，cues 数组决定 Dialogue 输出顺序；多出的 Dialogue 放到 Events 末尾。Comment 和分号注释保持模板位置，不作为字幕内容参与时间排序。

依赖检查：`ass_format` 的八个内部实现模块静态导入图无环，外部依赖仅标准库与 pysubs2；相关项目/HTTP 调用方向向下，没有发现格式模块反向依赖业务层。扫描不覆盖动态导入、第三方内部实现或全仓库依赖图。

## 3. 当前支持边界快照

下表区分实现行为与验证充分程度；“支持”不表示任意输入组合均已验证。

| 检查项 | 实际行为与证据 |
| --- | --- |
| `[Script Info]` | 要求 `ScriptType: v4.00+`；结构化 PlayResX/Y、ScaledBorderAndShadow。其他键值原样保留，见下文未明确边界。 |
| `[V4+ Styles]` | 完整标准字段；多样式、颜色及透明度、样式修改有现有测试。名称及数值仍有 F2/F3。 |
| `[Events]` / Format | 标准字段可重排；Text 必须最后。缺失、重复、未知字段及重复 Format 拒绝。已有事件和样式重排测试。 |
| Dialogue / Comment | Dialogue 可编辑；Comment 同样预检且保留，改名同步引用。已有 Comment 保留和使用中样式删除保护测试。 |
| 时间 | 严格 `h:mm:ss.cc`；内部整数毫秒、10ms 网格、`start < end`，上限 35999990ms。负数、零时长、倒序、非法精度及越界拒绝。 |
| 文本 | 中文、其他合法 Unicode、逗号、引号、普通括号与空正文可表示；不按 CSV 引号规则拆分 Text。基础中文/逗号已有断言，丰富字符组合覆盖不足。 |
| 文本控制序列 | 接受并保留原始 `\N`、`\n`、`\h`；不是把它们改成真实换行。未知反斜杠序列及末尾单独反斜杠拒绝。各序列组合缺少完整手工期望矩阵。 |
| Override tags | 仅接受 `\b0/1`、`\i0/1`、`\u0/1`、`\s0/1` 及连续组合。动画、卡拉 OK、定位、局部字体/颜色、绘图、其他标签或任意花括号内容拒绝。 |
| 编码和换行 | 文件入口严格 UTF-8，可带 BOM；CRLF/LF 接受，导出 LF。临时探测也确认 CR 接受；非法字节入口尚缺独立回归语料。 |
| PlayRes | 可缺失并保留 null；1–32768，重复及非法值拒绝。等比适配只接受完整、同宽高比、双方边框缩放为 yes 的设置。非规范键有 F1。 |
| 重叠、Layer 和顺序 | 允许重叠；保留 Layer、Name、MarginL/R/V；导出跟随 cues 顺序，列表时间排序独立。已有重叠样本和元数据保持测试，同层重叠渲染顺序覆盖不足。 |
| 样式引用 | 精确重名与缺失引用拒绝；内部稳定 ID、改名及删除保护已实现。仍存在 F2 的渲染名称冲突和 F4 的空白误拒。 |
| 未支持 Section / 事件 | 未知或重复 Section、SSA、附件、非 Dialogue/Comment 事件、非空 Effect 等整份拒绝，不删除后继续导入。 |
| 资源上限 | 1MiB、5000 个事件（包括 Comment）、1–1000 个样式、单条文本 16384 字符；导出再次完整预检。但接受导入与可导出之间有 F5。 |

## 4. 已确认问题

以下五项均未修复；建议修正方向不构成已经批准或完成的实施方案。

### F1 — P1：PlayRes 键名规范化改变未编辑文件的渲染

- 位置：`backend/ass_format/codec.py:143–156`、`:314–318`。
- 复现：读取 `fixtures/basic.ass`，仅将 `PlayResX:`、`PlayResY:` 改为 `playresx:`、`playresy:`，执行 `parse_ass → serialize_ass`。
- 实际：导入按大小写不敏感方式识别为 640×360；导出改写为规范大小写键。实际 JASSUB/libass 对原始小写键与规范键解释不同。
- 独立证据：在 Node 中加载仓库安装的 `jassub/dist/wasm/jassub-worker.js` 及 WASM，采用单线程、640×360 画布、仓库 Noto Sans SC 字体，对原始输入和导出结果分别 `createTrackMem`，在 2 秒处 `rawRender`。一个字形图块从 `w=245,h=50,x=204,y=304` 变成 `w=202,h=44,x=228,y=316`；未编辑导出即改变尺寸与位置。
- 原因：导入把渲染器不按该键识别的元数据提升为有效设置，导出使其正式生效。上游 [libass 0.17.4 ass.c](https://raw.githubusercontent.com/libass/libass/0.17.4/libass/ass.c) 的 `process_info_line` 也按规范大小写匹配脚本键；本次结论以实际安装 WASM 探测为主要证据。
- 建议：明确非规范键的接受策略；不能将会改变渲染含义的改写视作无害格式化。保护性拒绝应发生在文档被接受之前，并保留大小写变体重复检测。
- 限制：未验证所有播放器，也未穷举其他脚本键的大小写/空白变体。

### F2 — P1：样式名称的模型身份与渲染身份冲突

- 位置：`backend/ass_format/styles.py:16–24`、`:85–97`；导入重名检查位于 `codec.py:167–170`。
- 复现：将 `fixtures/basic.ass` 中的 `Emphasis` 全部替换为 `*Default`，保留已有 `Default`。
- 实际：Parser 返回两个独立样式 `Default`、`*Default`，Serializer 接受。实际 WASM 的两个输入样式名称却都成为 `Default`，两条 Dialogue 都引用后一个输入样式，字号为 30，而内部第一条仍引用字号 28 的样式。
- 影响：样式编辑、分配、使用数和删除保护基于内部独立 ID，不能准确反映实际渲染引用；编辑某个样式可能影响用户认为属于其他样式的字幕。
- 建议：在导入和创建/改名路径共同约束渲染器特殊名称，或检测渲染名称冲突。不得静默去掉星号合并样式。需增加实际引擎对照或明确手工期望，不能只用相同 Parser 往返证明正确。
- 限制：复现确认了这一组名称；没有穷举所有渲染器名称归一化行为。

### F3 — P2：宽松 Python 数值语法绕过 ASS 词法边界

- 位置：`backend/ass_format/styles.py:40–50`；适配计算位于 `:129–137`。
- 复现：将基础样本第一个样式的 `Fontsize=28` 分别改成 `2_8`、`２８`。
- 实际：两种值均通过 Parse 和 Serialize。后端 Decimal 将两者按 28 处理，640×360 到 1280×720 的等比适配均产生 56；实际安装 WASM 分别解析成 2、0。
- 影响：非法或非受支持语法没有保护性拒绝，样式编辑值、适配结果和预览解释不同。
- 建议：先限定明确的 ASS 数字词法，再做 Decimal 有限性、范围和适配检查。覆盖导入、样式操作和模板入口，不以 pysubs2 与 Python 同样接受作为标准兼容证据。
- 限制：没有据此否定所有科学计数法或其他未测试数字写法，应逐项确定支持边界。

### F4 — P2：样式引用空白的处理不一致

- 位置：`backend/ass_format/codec.py:189–190`、`:216–217`。
- 复现：将基础样本第一条 Dialogue 的 `,Default,译者` 改为 `, Default ,译者`。
- 实际：当前 WASM 正确引用 Default；后端报“事件引用了不存在的样式”，没有源行号。
- 原因：Cue 映射使用 `.strip()` 后的名称，但 canonical event 仍包含原始值，最终依赖 pysubs2 返回的未去空白字符串做存在性检查。
- 建议：统一映射及引用校验所用值，直接关联原始行位置；覆盖 Dialogue 和 Comment。修改应明确空白规则，不随意放宽其他语法。

### F5 — P2：大小边界只在导出时发现不可往返

- 位置：`backend/ass_format/codec.py:96–103`、`:224–231`、`:337–338`。
- 最小复现（仓库根目录，Python 环境需能导入 `ass_format`）：

```python
from ass_format import empty_document, parse_ass, serialize_ass

source = empty_document()['source']
source += ';' + 'x' * (1024 * 1024 - len(source.encode('utf-8')) - 1)
document = parse_ass(source)  # 1048576 字节，导入成功
serialize_ass(document)     # 补末尾 LF 后超限，抛 AssError
```

- 影响：无状态文件导入已经返回成功，但原样导出失败；本地工作区可能接受一个后续无法导出的文档。未实际观察到用户数据丢失，不将“无法导出”描述成已发生丢失。
- 项目路径区别：项目创建还会调用 Serialize 再检查，不能据此断言该文件已经能成功持久化。
- 建议：在导入成功前验证规范化输出预算，保证接受的未编辑文档可导出；覆盖无末尾换行及其他会扩大输出的规范化。

## 5. 边界不明确、产品例外与文档差异

### Script Info：保留不等于验证解释

`codec.py:137–157` 对 ScriptType 和三个结构化设置之外的元数据直接保留，不是完整字段白名单。临时探测确认 `WrapStyle: banana`、未知元数据键均可通过 Parse/Serialize。没有观察到这些行被删除，但也没有证明其渲染语义受支持。

因此 README 中概括性的“未知字段拒绝”需限定适用范围，不能被理解为所有 Script Info 键都受严格验证。后续应明确哪些是纯保留元数据、哪些影响渲染而需要校验；Timer、WrapStyle、YCbCr Matrix 等尚无系统性异常值和重复值测试。是否进一步收紧或扩展这些设置属于待决策边界，不在本次审计中自行改变。

### 本地空文件导入会补行

`frontend/src/workspace-ui/EditorWorkbench.tsx:403–408` 调用 `initializeDocument`。当导入文档无 Dialogue 时，`cue-defaults.ts` 增加一条 0–2 秒、首个样式、空正文的 Dialogue。包括只有 Comment 的文件，也可能触发该规则。

这是已有架构文档及 `cue-defaults.test.ts` 明确规定的产品行为，不应直接归为 Parser 缺陷。但它使本地 UI 的严格事件往返与底层空文档往返不同；后续验收应明确该例外或另行决定是否改变。项目打开不隐式补行。

### 剪贴板契约与文件导入不同

`backend/ass_format/clipboard.py` 会过滤普通文本空行，未知样式名回退到 active 样式；空文档使用首个样式。这是 [字幕行操作契约](../subtitle-line-operations.md) 已声明的行为，不能把文件导入的保护性拒绝承诺直接套用到剪贴板。

### 预览保真限制

内置 Noto Sans SC fallback、单一 Regular 字重及引擎合成粗斜体不能保证原字体外观；预览适配主动保留脚本 RGB，不承诺 VSFilter 历史色彩处理和跨播放器逐像素一致。详见 [预览模块 README](../../frontend/src/ass-preview/README.md)。上述限制与 ASS 数据是否被完整保留应分别验收。

### 错误提示与失败保护

常规解析失败抛 AssError，包含统一 code、message 和可获得的行号；HTTP 导入失败不返回部分文档，本地编辑器只在成功后替换当前文档。导出完整预检后才返回文本，不返回部分结果。

仍有缺口：缺失样式等文件末尾集中检查没有源行号；F5 说明导入接受条件与导出接受条件尚未完全一致。错误定位及接受时机都应纳入后续测试。

## 6. 现有测试与缺口

| 测试位置 / 名称 | 已有覆盖 |
| --- | --- |
| `backend/ass_format/tests.py` / `test_basic_roundtrip_preserves_semantics_and_anchors` | 中文、逗号、换行、多样式、Comment、分号注释与元数据；含手工字段断言及 pysubs2 对照。 |
| 同文件 / `test_reordered_format_is_mapped_before_pysubs2` | 事件字段重排。 |
| 同文件 / `test_time_grid_and_zero_length_rejected`、`test_unsupported_content_is_rejected_including_comment_and_edited_text` | 时间网格、零时长、未知特效/标签/Section、Comment 与编辑后拒绝。 |
| 同文件 / `test_bom_metadata_and_empty_document` | BOM、Aegisub 元数据、空文档与控制字符。 |
| `backend/ass_format/test_styles.py` | 稳定身份、改名、Comment 引用、使用中删除保护、字段重排、适配、脚本覆盖及迁移。 |
| `test_splitting.py`、`test_clipboard.py`、`test_inspection.py`、`test_migration.py` | 拆分元数据、剪贴板顺序、QC 共用校验、输出限制和历史升级边界。 |
| `backend/http_api/tests.py` / `test_empty_import_export_and_edit_contract` | 真实无数据库 HTTP Import → 编辑 → Export → Import，手工断言正文和时间。 |
| 同文件 / `test_supported_ass_larger_than_one_megabyte_as_json_roundtrips` | ASS 与 JSON 请求预算不同，较大有效文档通过 HTTP 往返。 |
| `backend/projects/tests.py`、`test_styles.py` 等 | 项目创建/保存校验、样式修改、冲突和原子性；本次只阅读，未运行数据库用例。 |
| `frontend/src/ass-preview/*test.ts`、`workspace-ui/preview-document.test.ts` | 预览调度、过期请求、失败隐藏/恢复及时间草稿投影。 |
| `frontend/browser-tests/ass-preview.mjs` | 已有真实引擎浏览器回归脚本，本次阅读但没有运行完整脚本。 |

主要缺口：

- 独立完整 ASS 文件语料主要为自制 `basic.ass` 和 `unsupported.ass`，另有固定历史 JSON；尚无按有效、变体、文本、元数据、非法输入分类的兼容语料矩阵。
- F1–F5 均未被现有回归测试覆盖；本次临时探测没有转成新增测试。
- 严格解码失败、CRLF/LF/CR 组合、丰富 Unicode、`\N/\n/\h` 组合、文本首尾空白与特殊符号，缺少系统性手工期望样本。
- Script Info 异常及重复值、名称渲染碰撞、同层重叠及事件顺序，缺少独立语义或引擎对照。
- 已有 HTTP 往返，但未找到包含完整受支持元数据、贯穿项目持久化再导出/再导入的语义矩阵；不能把无状态 HTTP 测试当作数据库项目闭环验收。
- pysubs2 既是生产依赖又是部分测试的对照工具，可检查部分语义，但独立性有限。仅同一 Parser 往返无法发现 F2/F3 这种与实际渲染器的解释差异。
- 不需要为了测试数量引入 Property-based Testing；优先固定已复现输入、清晰手工期望及少量实际引擎差异验证。

## 7. 实际执行结果

以下均于 2026-11-10 执行；归档时不将这些结果重新标为 2026-11-11 的测试结果。

仓库根目录：

```sh
DJANGO_SECRET_KEY=ass-readonly-audit .venv/bin/python backend/manage.py test ass_format http_api.tests http_api.test_clipboard http_api.test_qc --noinput --verbosity 1
```

结果：54 项通过，Django system check 无问题；不使用项目数据库测试。

在 `frontend` 目录：

```sh
npm run test -- --run src/ass-preview src/workspace-ui/preview-document.test.ts src/workspace-ui/cue-defaults.test.ts src/style-ui/style-fields.test.ts src/workspace-ui/line-edits.test.ts src/workspace-ui/commit-timing.test.ts src/subtitle-model
npm run typecheck
```

结果：7 个测试文件、44 项通过；TypeScript 检查通过。不是前端全套测试或生产构建结果。

其他实际验证：

- 内存 Python 探测：换行、空正文、格式错误、重复/缺失样式、PlayRes、未知元数据，以及 F2–F5 的输入行为。
- 实际安装 JASSUB WASM 的独立 Node 探测：F1 的渲染图块变化、F2 的样式与事件索引、F3 的解析字号、F4 的有效样式引用。未替换引擎为 mock，未启动浏览器；这不替代浏览器完整预览验收。
- `ass_format` 八个内部实现模块的 AST 静态依赖扫描：无环；外部导入为标准库和 pysubs2。
- `git diff --check` 通过，审计结束时工作树干净。

未执行：新增回归测试、修复、数据库项目集成、完整浏览器回归、跨平台视觉检查、构建或全仓库静态依赖审计。

## 8. 后续建议与待决策项

内部 Alpha 前建议修复 F1–F5，先处理非预期渲染变化、样式身份冲突和数字词法，再修复空白引用及导入/导出预算不一致。优先为已确认输入建立失败回归，然后在现有格式模块内小步修复；预计无需改变实时协作或公共 DTO。

Script Info 的严格校验范围、本地空导入补行及剪贴板回退需要与已有产品契约区分。后两者已有明确设计依据，不应在格式修复中顺手改变；若要求所有入口都满足严格语义往返，应先说明兼容性影响并由用户决定。

本报告没有授权或实施第二、第三阶段，不声称完整 ASS 标准兼容，也不声称已经消除全部静默数据损失风险。
