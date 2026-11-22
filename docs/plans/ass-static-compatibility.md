# 常用 ASS 静态标签兼容

状态：2026-11-22 已实现并完成本批验证，未提交或推送。

## 确认范围与决策

用户明确选择方案 1：c、1–4c 颜色，alpha、1–4a 透明度，an 对齐、pos 固定位置、裸 r 重置。fn/fs、bord/shad、具名 r 留待后续；运动/动画/绘图/卡拉 OK/附件继续拒绝。不包含多人实时协作或新可视化控件。

初始工作树干净；原正文仅接受 b/i/u/s 0/1 与 N/n/h。先完成盘点、85 项后端基线与原四份语料引擎验证，再询问范围；等待时提取原正文 token（97 项后端、543 项前端通过），用户确认后扩展。没有覆盖其他人的未提交修改。

- 颜色：`&H` + 1–6 位 ASCII 十六进制 + `&`，BGR；alpha：1–2 位，可省末尾 `&`。无参数恢复行样式对应颜色/alpha，按原顺序覆盖，不截断参数、不接纳尾垃圾。
- an：单个 1–9；pos：普通有符号十进制坐标、ASCII 参数空白，|坐标|≤32768。每行各最多一次，跨块/r 统计；重复定位明确拒绝，不复制 libass 的静默忽略。
- 裸 r 恢复 cue 所分配样式的文字属性，保留 an/pos；r 后仍可覆盖。具名 r 不开放，避免新增正文样式引用与改名/删除/粘贴身份问题。
- 合并仍拼接原文，格式延续；r 取幸存首行的样式。重复定位导致整个合并失败，原字幕与历史保留。文本光标拆分继续拒绝标签/转义。
- SRT 复用 token，正确恢复 r 后基础格式；省略颜色/透明度/定位，在原 QC 面板明确提示透明文字变为可见。原空白行、时间轴形正文和资源限制继续拒绝。

## 所有权与实现

`ass_format/text.py::text_tokens` 独占正文词法、范围与整行组合校验。codec、inspect、Comment、剪贴板共用；SRT 向下消费 ASS 公共 token，不再独立识别 ASS 文法。无 Django/文件/网络依赖，无新运行时库。

`workspace-ui/cue-search → subtitle-model/ass-text` 仅作词法投影，不验证参数范围、整行组合或文件合法性；替换/合并/保存/预览仍走正式完整导出校验。CPS/QC 继续忽略标签并计入透明正文。styles、source 锚点、事件顺序、schema v2、revision、权限、历史和草稿模型不变。

新增手写 `fixtures/compatibility/static-overrides.ass` 及 authored expected.json，自动纳入原 codec/HTTP/项目持久化语料测试；新增 static-editing.ass 用于真实浏览器。旧 unsupported pos 反例改用仍拒绝的 move。`test_text.py` 检查参数/组合/定位、样式改名/使用中删除/无引用删除、不可变操作、复制粘贴及拆分保护。SRT、搜索、替换、合并、CPS/QC 同步回归。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| `manage.py test ass_format srt_format http_api.tests http_api.test_ass_compatibility http_api.test_srt http_api.test_qc http_api.test_clipboard --settings=application.test_settings --noinput -v 0` | 112 项通过；[日志](/private/tmp/cuerelay-ass-static-backend.log) |
| 独立 PostgreSQL 上 `manage.py test ass_format srt_format http_api projects --settings=application.test_settings --noinput -v 2` | 196 项：195 通过、1 项既有 Nginx 代理测试因未设置 NGINX_BINARY 跳过，17.678s；[日志](/private/tmp/cuerelay-ass-static-backend-dac_d9t7/django.log) |
| `npm run test -- --run src build` | 65 文件 / 547 项通过 |
| `npm run typecheck`、`npm run i18n:check` | 通过，941 个双语资源项 |
| `npm run test:ass-compatibility` | 实际 JASSUB 2.5.23 WASM：颜色/alpha 分量、顺序、各分量无参数恢复、裸 r/行样式、定位位移/对齐、五份语料引擎样式/事件/位图往返全部通过；[日志](/private/tmp/cuerelay-ass-static-engine.log) |
| 新增真实浏览器 `test_ass_static_local/project` | 2/2 通过，无重试，14.068s；[逐例结果](/private/tmp/cuerelay-ass-static-targeted-rwbiwmor/scenario-results.jsonl)、[日志](/private/tmp/cuerelay-ass-static-targeted-rwbiwmor/django.log) |
| 相邻既有真实浏览器 | SRT 三例、查找替换两例、合并两例、剪贴板保存、样式操作共 9/9 通过；[逐例结果](/private/tmp/cuerelay-ass-static-targeted-68o42ita/scenario-results.jsonl) |
| `python -m unittest scripts.test_regression_selection -v` | 通过；所有 Django 入口和 Playwright 场景一一匹配 |
| Vite 生产构建 | 使用原配置、许可和手册插件，公开 build API 禁用 .env，2.55s 通过；[日志](/private/tmp/cuerelay-ass-static-build.log)，产物 `/private/tmp/cuerelay-ass-static-dist`；保留既有大 chunk 提示 |
| 受影响依赖图 | ASS/SRT 15 个运行时 Python 模块、查找投影可达 5 个 TS 模块静态遍历无环；无 ASS→SRT 或底层→UI 新依赖 |
| `manage.py check --settings=application.test_settings`、`git diff --check` | 通过 |

新增浏览器覆盖：本地文件导入、跨 r 替换、撤销重做、重复 pos 合并失败原子性、正常合并、IndexedDB 刷新恢复、ASS 下载再导入、SRT 提示与正文；项目实际 JASSUB 预览变化、显式保存、重载和两格式导出。已查看真实截图，顶部红色半透明正文和 r 后白色正文正确显示。WASM 另外核对实际位图掩码、颜色和坐标，避免只凭字符串往返自证。

## 验证中的修正与限制

- 首轮新增两例都走到 ASS 下载，但测试错误地等待了仅在有 QC 问题时出现的“继续导出 ASS”；无问题的 ASS 本应直接下载。只修正测试事件监听/流程后在全新服务中 2/2 通过，未改产品导出逻辑。首轮其他九例均通过，失败证据保留在上表首轮目录。
- 曾假设 2a 不影响任何图块；实际 libass 会改变部分掩码组合，故不作这个错误断言，改为验证实际引擎行为与 ASS 往返保持。2c 的非卡拉 OK 对照仍验证。
- 默认 `npm run test -- --run` 的既有 Vitest exclude 未排除 platform-tests，误收集三个需要真实夹具的 Playwright 文件后失败；未扩张本批范围修改测试配置，使用 src/build 运行完整单元范围。此问题单独报告。
- 实际浏览器仅 Chromium、合成黑色视频；没有真实片源验收或跨播放器视觉一致性承诺。未运行全量浏览器矩阵；Nginx 代理测试仍未执行。
- 运行器 `/private/tmp/cuerelay-run-ass-static*.py` 复用仓库 fixture/断言、临时 PostgreSQL 与隔离 Vite 缓存，不读 .env、不接触开发/生产数据库。后端与两轮浏览器分别新建集群，最后均仅余 postgres/template0/template1；pg_ctl stop=0、status=3、无 postmaster PID。首轮与并行检查期间修改过文档/测试且单元检查更新默认缓存，记录 source/cache changed；最终两例运行的源码及默认缓存哈希均保持不变。

## 依据

[Aegisub 官方标签文档](https://aegisub.org/docs/latest/ass_tags/) 与 [libass ass_parse.c](https://github.com/libass/libass/blob/master/libass/ass_parse.c) 用于语义和参数研究；实现接受明确的有界子集，实际语义再由安装的 JASSUB WASM 验证。完整公开规则见 [ass_format README](../../backend/ass_format/README.md#常用静态正文标签2026-11-22)。本批没有未决产品问题。
