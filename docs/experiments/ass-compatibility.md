# ASS 兼容性第二、三阶段验证（2026-11-11）

范围：核验 [第一阶段审计](../reviews/ass-compatibility-audit-2026-11-10.md) F1–F5，建立回归语料并局部修复。支持规范唯一入口为 [ass_format README](../../backend/ass_format/README.md#文件兼容性契约)，本文只记录证据与执行结果，不另建支持清单。

## 核验与修复

先在原实现运行最初 7 项审计回归，全部未达到预期：F1/F2/F3/F5 没有拒绝危险输入，F4 空白引用报错、缺失引用没有行号。原实现失败日志保存在执行环境临时文件，不作为仓库依赖。

| 审计项 | 核验结果与最终修复 | 回归入口 |
| --- | --- | --- |
| F1 | 确认。小写 PlayRes 键原先被后端提升为有效设置，真实引擎的渲染图块因此变化。现在在读取时拒绝结构化设置键的大小写/冒号前空白变体，保留重复检测与源行号。 | `AuditRegressionTests.test_f1_noncanonical_structured_script_keys_rejected_at_source_line`；WASM 的字形比较。 |
| F2 | 确认。实际引擎把 Default 与 *Default 解释为同名，事件引用同一后定义样式。导入及文档最终校验拒绝星号开头样式名；不修改字体名规则，不合并身份。 | `test_f2_renderer_alias_style_names_rejected_without_merging`；`StyleBoundaryRegressionTests.test_alias_names_rejected_by_create_rename_copy_template_and_export`；WASM 引用索引。 |
| F3 | 确认。2_8、２８ 在 Decimal 中是 28，在实际引擎中是 2、0。共享样式校验先检查 ASCII 十进制词法，再检查 Decimal 范围；继续接受经过引擎对照的符号/小数/指数写法。 | `test_f3_python_only_numeric_syntax_rejected_in_each_decimal_field`；`test_numeric_lexical_boundary_shared_by_operations_templates_and_scaling`；WASM 数值断言。 |
| F4 | **原审计的渲染解释有误，必须区分前导和尾部空白。** 前导 ASCII 空格/Tab 能正确引用；尾部空白导致 libass 匹配失败并回退 Default。原审计只测 Default，回退掩盖了失败。现在接受并统一前导 ASCII 空白，拒绝尾部/非 ASCII 前导空白；在收集完定义后逐事件校验引用，给出名称与源行号。 | `test_f4_leading_ascii_whitespace_references_normalize_for_dialogue_and_comment`、`test_f4_trailing_or_non_ascii_reference_whitespace_rejected_before_fallback`、`test_f4_missing_reference_located_even_if_style_section_follows_events`；WASM 的 Emphasis 尾空白反例。 |
| F5 | 确认。1MiB 无末尾换行的输入可导入，但序列化补 LF 后超限；记录前缀规范化也可能扩大输出。导入返回前复用现有完整序列化校验，不复制预算算法、无递归；不可导出的初始文档立即拒绝。 | `test_f5_import_checks_normalized_output_budget_before_acceptance`、`test_f5_output_expansion_from_record_spacing_is_also_preflighted`；HTTP 422 测试；UTF-8 恰好可导出上限测试。 |

生产实现只改 `ass_format/codec.py` 与 `styles.py`。没有公共 DTO/API、数据库模型或迁移变化，没有修改保存/CAS、WS、编辑锁、账号/组织逻辑或 UI。导入预检多执行现有序列化/检查路径，以明确接受条件；没有新增依赖或另一套解析器。

## 回归语料与独立证据

- [compatibility 语料](../../backend/ass_format/fixtures/compatibility/README.md)：4 份有效完整文件、初轮 8 份非法完整文件（复核补修后为 15 份）；`expected.json` 是手写语义期望，不由被测 Parser 生成。逐字段断言全部样式属性、脚本设置、按名称解析的有序 Cue；独立断言精确导出事件，覆盖隐藏的 Layer/Name/Margins/Comment、正文及顺序。
- [test_compatibility.py](../../backend/ass_format/test_compatibility.py)：Unicode/组合字符、逗号/引号/普通标点、空正文、文本首尾空格、N/n/h、b/i/u/s 组合、重叠/乱序、10ms/最大时间、Format 重排、缺失脚本设置、BOM/LF/CRLF/CR/混合换行、非法输入变体、1MiB UTF-8 字节/5000 事件/文本长度，以及创建/改名/复制/批量/模板/适配共享校验。无 Property-based Testing 依赖。
- [HTTP 测试](../../backend/http_api/test_ass_compatibility.py)：实际 JSON Import → Export → Import，沿用手写期望；非法输入返回 422 与位置，不返回部分文档；规范化超限在导入时拒绝。
- [项目测试](../../backend/projects/test_ass_compatibility.py)：PostgreSQL 下通过实际项目 HTTP 创建、读取、编辑保存、重新读取、导出及重新创建项目；保留完整模板、样式、隐藏事件字段和预期 revision。空轴和仅 Comment 文件不隐式补行；非法语料不留下半成品项目。
- [前端文件测试](../../frontend/src/project-data/ass-api.test.ts)：非法 UTF-8、截断/代理编码及超限文件在请求前拒绝；BOM/CRLF 原样交给后端；源行号错误向调用层抛出。它使用真实 TextDecoder，HTTP 响应为 mock，不声称它本身是服务器集成。
- [独立引擎脚本](../../frontend/browser-tests/ass-compatibility.mjs)：加载实际安装 JASSUB 2.5.23 的未修改 WASM，单线程、640×360、仓库 Noto Sans SC 字体；核验 F1–F4 的解释差异与有效数值，再比较四份有效语料导出前后的引擎 styles/events、ReadOrder、样式引用、字形几何/颜色及位图哈希。仅用本地字节替换文件传输，不 mock 解析/渲染。libass 会去掉文件文本尾部 ASCII 空白，DTO/导出仍按另一个明确测试保留它们。

## 初轮实际执行

仓库根目录，载入本机 `.env`（不输出其内容），使用本机 PostgreSQL 的隔离 Django 测试库：

```sh
.venv/bin/python backend/manage.py test ass_format http_api projects organizations --noinput --verbosity 1
.venv/bin/python backend/manage.py makemigrations --check --dry-run
```

最终结果：141 项，140 通过、1 项跳过，Django system check 无问题；无迁移变化。跳过项为已有真实 Nginx 反向代理测试，环境未设置 `NGINX_BINARY`，不属于 ASS codec 验证。测试库按 Django 正常创建/销毁，没有在真实项目上执行写入。首次受限沙箱连接 PostgreSQL 被阻止，获自动审批后重跑成功。

在 `frontend`：

```sh
npm run test -- --run
npm run typecheck
npm run build
npm run test:ass-compatibility
```

结果：46 文件、406 项前端单测通过；TypeScript 检查通过；生产构建通过（保留超过 500kB chunk 的构建提示）；真实 WASM 对照通过。语料最终去掉物理行尾空格以符合仓库 whitespace 检查，文本尾空格通过显式字符串回归测试覆盖；随后重跑受影响的格式/HTTP/项目、前端文件测试及 WASM，均通过。

其他检查：8 个 `ass_format` 内部实现模块 AST 静态导入图无环，外部依赖仅标准库/pysubs2；没有向 Django/HTTP/ORM 的反向导入。`git diff --check` 及新增文件 whitespace 检查通过。人工检查 Diff，生产改动限定于格式校验与接受时机，没有无关重构。

未执行完整 Chrome 播放/预览生命周期回归、多平台视觉比较或全 ASS 标准认证；独立 WASM 检查不替代这些验收。没有对任意 Script Info 或任意播放器作兼容保证。

## 复核 R1–R3 补修（同日）

再次用当前实现和真实 WASM 独立复现 [复核报告](../reviews/ass-compatibility-follow-up-2026-11-11.md) 全部反例，确认属实：R1 的非 ASCII 键/值空白与 R2 的样式字号/名称预先去空白会改变未编辑导出的图像；R3 的 Default 大小写变体不会改变往返图像，却让不同模型 style_id 均引用 Default。上轮检查没有覆盖这些原始词法与身份组合。

修复仅继续修改 `codec.py` / `styles.py`：

- R1：语法行、记录键和结构化值只移除 ASCII 空格/Tab；宽泛的键名匹配只用来识别并拒绝非规范键，不改写它。Format、时间、Layer/Margin、空 Effect 采用同一语法空白规则，避免同类预处理绕过。
- R2：按声明 Format 映射原始样式字段，Name/Fontname 只去安全的前导 ASCII 空白，其他字段只去前后 ASCII 空白；非 ASCII 边界空白及名称/字体尾空白保留至共享验证并拒绝，错误附字段名和源行号。Unicode 字幕正文、Comment 正文和纯保留元数据不作全局禁止。
- R3：共享样式名称校验拒绝 `default` / `DEFAULT` / 混合大小写等保留名变体。普通 `foo` / `Foo` 保持两个身份；创建/改名/复制/模板导入/直接导出全部通过相同最终校验，不静默合并。

新增 [test_follow_up.py](../../backend/ass_format/test_follow_up.py) 的 9 项测试（含参数化子项），先复现拒绝规则失效再修复；测试名称包括 `test_r1_structured_keys_and_values_reject_unicode_boundary_whitespace`、`test_r2_style_fields_reject_unicode_boundary_whitespace_before_normalizing`、`test_r3_names_rejected_by_create_update_copy_template_and_direct_export`。覆盖 U+00A0/U+2003/U+3000、全部 23 个样式字段的标准/重排 Format、安全 ASCII 空白、文本/元数据保留及普通大小写名称对照。

另加 7 份独立非法文件与手写错误位置，自动复用既有 HTTP 422/无部分文档及 PostgreSQL 初始化失败不落库测试。WASM 脚本增加原反例、安全 ASCII 对照，以及每次有效往返前后的模型 style_id → 实际引擎样式名称/字号/字体断言；在 2s 和 3.6s 分别覆盖实际受影响事件，不再只以图像往返相同推断身份正确。

本轮实际运行（仓库根目录，后端载入本机环境并用隔离 PostgreSQL 测试库）：

```sh
.venv/bin/python backend/manage.py test ass_format http_api projects organizations --noinput --verbosity 1
```

结果：150 项，149 通过、1 项已有 Nginx 环境测试跳过；Django system check 无问题。测试库正常创建/销毁，没有写入真实项目。在 frontend 运行 `npm run test:ass-compatibility` 与 `npm run typecheck` 均通过。另执行 8 个格式实现模块的 AST 导入无环/依赖边界检查、已跟踪与新增文件 whitespace 检查，均通过；人工审查 Diff，未更改公共 DTO/API、模型、保存/revision、实时协作或 UI。

本轮没有重跑前端全部单测、生产构建、迁移生成检查或完整浏览器回归；上节初轮结果不作为本轮重新执行的结果。

## 剩余边界与 Alpha 建议

F1–F5 的原始复现用例已处理，F4 按真实引擎证据纠正策略。2026-11-11 后续独立复核在初轮结果中确认三类遗漏：结构化脚本设置的非 ASCII 空白绕过、样式字段预先去空白导致语义变化，以及 Default 大小写变体的渲染身份冲突。原有回归均通过，但不足以证明这些问题类别已完全解决；复现、影响、建议与本次重跑结果见 [修复复核报告](../reviews/ass-compatibility-follow-up-2026-11-11.md)。这些反例在复核时的修改前后均被接受，属于遗留缺口；复核没有发现可确认由初轮修复引入的新回归。本轮已按上述 R1–R3 补修并转为自动化回归，具体反例已不再被接受；这不代表这些问题类别已被穷举。

以下不扩大产品范围：未结构化 Script Info 原文保留但不全面验证，Timer/WrapStyle/YCbCr Matrix 异常值与重复值的严格接受策略仍待决定；复杂特效/附件继续拒绝；本地空轴补行和剪贴板回退维持既定产品行为；字体替代与跨播放器像素一致性不承诺。原件字节归档仍不由编辑导出承担。

部署校验收紧版本前，建议对已有项目/隔离备份运行现有只读 `check_style_migration`。旧实现接受的非规范键/非 ASCII 语法空白、星号或 Default 大小写变体名称、Python 数字、尾空白名称/字体或引用不会自动修复，须保留原件/备份后人工确认。若 Alpha 要接受更广泛的 Script Info 渲染设置，应先决定哪些字段结构化验证、哪些严格拒绝，再另立范围明确的测试与实现任务。
