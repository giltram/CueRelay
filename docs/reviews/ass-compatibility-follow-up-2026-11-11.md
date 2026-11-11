# ASS 兼容性修复复核（2026-11-11）

依据：[第二、三阶段实验记录](../experiments/ass-compatibility.md)及[第一阶段审计](ass-compatibility-audit-2026-11-10.md)。本次核对当前工作区尚未提交的修复，并重跑相关测试和独立引擎探测。复核期间未修改实现、测试或原有文档；之后按用户要求归档本报告并更正实验记录的结论。

## 结论

F1–F5 的原始复现用例已修复，F4 根据真实引擎纠正前导/尾部空白策略的处理成立，F5 的导入输出预算预检通过回归。但补充输入仍暴露下列三类兼容性遗漏，不能将原有测试通过解释为这些问题类别已完全解决。

没有发现可确认由本次生产代码修改引入的新回归。下列反例在修改前 `HEAD`（`3e225ba74e48f25691a3799e4de6b95b7ec0806c`）与当前工作区均可导入并导出，属于已确认的遗留缺口；这不等于证明不存在其他回归。

所有反例均基于仓库自制 [basic.ass](../../backend/ass_format/fixtures/basic.ass)，使用已安装 JASSUB 2.5.23 的真实 WASM、640×360 画面及仓库 Noto Sans SC 字体核验，不依赖外部字幕或播放器推测。下文 `\u00a0` 表示实际 U+00A0 不换行空格，不能用六个可见字符代替。

## R1 — P2：结构化脚本设置仍可被非 ASCII 空白绕过

位置：`backend/ass_format/codec.py:136`、`:148–151`。

`raw.lstrip()` 在比较键名之前移除所有 Python 识别的前导空白，`value.strip()` 又在数值验证前去掉非 ASCII 空白。因此新增的精确键名校验仍允许原引擎不能按相同方式解释的输入。

最小输入变换（JavaScript）：

```js
// 分别测试两个变体；每次从原 basic.ass 开始。
basic.replaceAll('PlayResX:', '\u00a0PlayResX:')
     .replaceAll('PlayResY:', '\u00a0PlayResY:');
basic.replace('PlayResX: 640', 'PlayResX: \u00a0640')
     .replace('PlayResY: 360', 'PlayResY: \u00a0360');
```

实际结果：导入返回 200；未经编辑导出后，字段变成规范的 `PlayResX: 640` / `PlayResY: 360`。真实引擎在导出前后的字形几何与位图哈希不同。以 2 秒首个渲染图块为例，宽高由 130×46 变为 110×43，位置由 `(256,270)` 变为 `(269,288)`。

影响：仍会在未编辑时改变字幕尺寸和位置，属于 F1 同类遗漏。对照中的普通 ASCII 前导空格未造成同样变化。

建议：在丢弃原始字符之前检查键和值的词法；仅规范化已由引擎证据确认无害的空白，拒绝上述非 ASCII 变体并返回源行号。补充导入和 WASM 回归。

## R2 — P2：样式字段预先去空白绕过名称和数字校验

位置：`backend/ass_format/codec.py:168–169`；下游校验位于 `backend/ass_format/styles.py:31–43`。

所有样式字段先通过 `p.strip()`，后续名称空白检查和 ASCII 数字正则只能看到已被改写的值。这一个预处理问题有两种已复现的后果。

```js
// 字号前添加实际 U+00A0。
basic.replace(',28,', ',\u00a028,');

// 只修改样式定义，保留事件中的 Emphasis 引用。
basic.replace('Style: Emphasis,', 'Style: Emphasis ,');
```

- 数字变体：导入返回 200，模型字号为 `28`；原始文件的 WASM `FontSize` 为 `0`，导出后为 `28`。在 2 秒处的实际渲染图块也不同，属于 F3 词法边界的遗漏。
- 名称变体：原始定义为 `Emphasis `，引擎中事件的 `Emphasis` 引用匹配失败并回退 Default（样式索引 1）；导出删除名称尾空格后，事件改用 Emphasis（索引 2）。在 3.6 秒处，首图块位置由 `(252,305)` 变为 `(248,34)`，位图也变化。定义名称的 U+00A0 前缀或后缀同样复现错误。

影响：未经编辑导出即可改变字号或实际引用的样式。F4 对事件引用的空白检查没有覆盖样式定义一侧。

建议：按字段验证原始词法，避免统一 `strip()` 后才校验。名称尾空白及数字非 ASCII 前导空白应保护性拒绝；若保留部分空白兼容，应分别由引擎对照确认。补充名称定义与事件引用组合的回归，渲染时刻必须覆盖受影响事件。

## R3 — P2：Default 大小写变体仍产生模型与渲染身份不一致

位置：`backend/ass_format/styles.py:61–67`。

新增样式名校验仅拒绝星号前缀，仍允许 `Default` 与 `default` / `DEFAULT` 成为独立样式。

```js
// 分别从原 basic.ass 开始，替换定义及事件引用。
basic.replaceAll('Emphasis', 'default');
basic.replaceAll('Emphasis', 'DEFAULT');
```

实际结果：导入、导出均成功；模型为两条字幕保存不同的 style_id，WASM 的两条事件却都使用索引 1 的 `Default`，第二个样式未被引用。该样式原本字号 30、顶部对齐，实际渲染使用字号 28、底部对齐的 Default。导出前后均存在此错误；仅检查文件往返图像相等不能发现模型与渲染身份不一致。

影响：用户选择或编辑 `default` / `DEFAULT` 样式时，显示结果可能继续采用另一份样式，属于 F2 同类遗漏。

建议：在共享样式名称校验中处理 Default 的这些保留名称变体，覆盖导入、创建、改名、复制及模板导入。不要将所有样式名一律按大小写合并：对照中的普通 `foo` 与 `Foo` 能分别正确引用。增加“模型选中样式与引擎实际引用样式一致”的断言。

## 实际执行与证据边界

本次重新执行：

| 检查 | 结果 |
| --- | --- |
| `.venv/bin/python backend/manage.py test ass_format http_api projects organizations --noinput --verbosity 1` | 141 项：140 通过、1 跳过；system check 无问题。 |
| `npm run test -- --run`（frontend） | 46 文件、406 项通过。 |
| `npm run typecheck`（frontend） | 通过。 |
| `npm run build`（frontend） | 通过；仍有超过 500kB chunk 的提示。 |
| `npm run test:ass-compatibility`（frontend） | 原有 F1–F4、有效数字及四份语料的 WASM 对照通过。 |
| `git diff --check` | 通过。 |
| `ass_format` 内部实现模块 AST 静态导入检查 | 8 个模块无环，外部导入仅标准库及 pysubs2。 |

后端测试载入本机环境并使用 Django 隔离 PostgreSQL 测试库，正常创建/销毁；没有写入真实项目。初次沙箱连接被阻止，经自动审批后重跑成功。跳过项是未设置 `NGINX_BINARY` 的已有 Nginx 代理测试。

补充探测沿用 [ass-compatibility.mjs](../../frontend/browser-tests/ass-compatibility.mjs) 的真实 WASM 初始化、`track`、`render` 和 [codec 桥接](../../frontend/browser-tests/ass-codec.mjs)，分别比较原文与 `serialize_ass(parse_ass(source))` 的 styles/events 和图像。字号反例在 2 秒检查，Emphasis 名称反例在 3.6 秒检查。本文记录输入变换及实际结果，不依赖临时脚本或临时日志长期存在；这些补充反例尚未加入自动化测试。

修改前后的接受行为另以临时目录中的 `HEAD` 格式模块和当前模块分别执行 `parse_ass` / `serialize_ass` 对照，两者均接受上述反例。未修改当前源码来完成此对照。

本次未运行完整浏览器播放/预览生命周期、跨平台视觉验收或全 ASS 标准认证，也未重跑迁移生成检查。上述发现均有具体输入与引擎证据，不是对未结构化 Script Info 等已声明范围外能力的新增要求。

## 后续处理

优先补充 R1–R3 的失败回归，再分别修复原始词法校验和保留样式名边界。修复时保持既有 DTO、源行锚点、保存/revision 和模块依赖方向，并同步唯一格式契约入口 [ass_format README](../../backend/ass_format/README.md)。本报告归档不代表这些修复已经完成。
