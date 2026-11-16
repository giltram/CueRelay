# CueRelay 工作区只读 review — 2026-11-16

## 范围与结论

- 基准：`0f9b1e0`；审查时 HEAD：`b383b98dbf156627f48ab9c50f10ad8d410c097b`，两者之间 17 个提交。
- 范围包含基准至当前工作区的已提交、已暂存、未暂存及未跟踪内容。审查时暂存区为空；tracked diff 为 446 个文件、25,206 行增加、1,416 行删除；另有 79 个未跟踪文件（不含本报告）。未跟踪的国际化模块、消息契约、迁移及测试也纳入审查。
- 发现 3 项新的 P2 正确性问题；未确认新的 P0/P1、安全越权或持久化数据丢失问题。测试通过不代表覆盖了全部并发顺序与平台组合。
- 本次仅新增本报告；未修复代码、提交或推送。构建、补充复现脚本、浏览器产物和独立 PostgreSQL 集群位于 `/tmp`；临时数据库及两个 Vite 服务已停止。未连接开发或生产数据库。

先阅读了 `AGENTS.md`、`docs/architecture.md`、相关模块 README、测试说明及已有七份 review：2026-10-26 仓库审计、2026-10-30 工作区 review、2026-11-07 浏览器性能、2026-11-10 性能 handoff/follow-up 与 ASS 兼容性审计、2026-11-11 ASS follow-up。已有报告标记修复的问题未重复列入；性能报告尚待真实媒体/网络证据的项目仍属于未覆盖范围。

## 发现

### F1 · P2 · 会话失效后，仍可点击的「导出 ASS」静默失效

**位置：** `frontend/src/workspace-ui/EditorWorkbench.tsx:478–480`。

**触发场景：** 用户保留尚未保存的字幕时，会话过期或其他标签页改变登录状态。应用保留当前文档，但普通「导出 ASS」按钮不再产生下载，也没有错误提示。

**证据与原因：**

- `App.tsx:288` 在 `!user` 时设置 `shortcutsPaused`。
- `EditorWorkbench.tsx:127–128` 将该状态用于 `qcEnabled`，所以会话失效后 QC 被禁用。
- `use-subtitle-qc.ts:30–32` 在禁用时直接返回 `null`；新增的 `exportWithQc()` 收到 `null` 后直接退出，永远不进入 `downloadDraft()`。
- `EditorWorkbench.tsx:516` 的导出按钮只检查 busy、document 和 checking，仍然显示为可用。已有 QC 面板中的继续导出同样受 `!qcEnabled` 限制。

**实际复现：** 在生产构建的 Chromium 页面中，使用仓库 `i18n-fixtures.mjs` 控制会话响应，字幕内容设为 `本地未保存字幕`。先正常导出得到下载；随后使会话查询返回匿名并触发 window focus，确认会话失效提示出现。再次点击仍启用的导出按钮，检查与导出请求计数均不增长：

```text
before: { exports: 1, inspections: 1 }
after:  { exports: 1, inspections: 1 }
buttonEnabled: true
draft: 本地未保存字幕
page errors: []
```

这是实际 React/生产构建的交互复现，身份响应由 fixture 提供；不是完整真实会话后端 E2E。控制流也直接证明该点击不会发送导出请求。

**影响：** 恰在无法保存到账号时，普通备份导出入口不可用。没有观察到字幕被清除；切换流程使用的 imperative `exportDraft` 路径仍可工作，因此不将其描述为所有备份路径失效或已发生数据丢失。

**建议：** 将保留文档的导出/导出校验能力与编辑快捷键、登录状态解耦，保留必要的格式校验。补充「有本地修改 → 会话失效 → 点击普通导出 → 下载包含当前修改」回归测试。

### F2 · P2 · 迟到的设置查询覆盖已经成功保存的语言选择

**位置：** `frontend/src/i18n/use-language-preference.ts:45–48`（未跟踪的新文件）；关联 `frontend/src/App.tsx:83–89`。

**触发场景：** focus 或周期检查发出的 `/me/settings` GET 已读取旧语言、尚未返回；用户切换语言，PATCH 成功；旧 GET 此后到达。

**证据与原因：** 语言 hook 的序列号保护了自身 PATCH 回包，但成功后立即清空 `choice`，使语言重新取自传入的 `saved`。`loadContext()` 的 `epoch` 只防账号上下文变化，同账号的语言写入不使旧 GET 失效；旧结果随后通过 `setSettings(preferences)` 整体覆盖新设置。因此成功操作会被陈旧快照在界面上撤回。

**实际复现：** 在生产构建的个人设置页，初始 `zh-CN`；拦截并延迟一次 focus 发出的设置 GET，保留旧快照。选择 `en`，等待 PATCH 完成、选择器恢复启用且 HTML `lang=en`，再释放旧 GET。得到：

```text
server preference: en
selector value: zh-CN
html lang: zh-CN
writes: [{ path: /api/me/settings, actor: 1,
           data: { language_preference: en } }]
page errors: []
```

此复现使用真实生产前端及可控 API fixture，精确控制响应顺序；未声称它覆盖所有真实网络时序。

**影响：** 用户看到保存成功后，界面及选择器突然切回旧语言，与服务器已保存值不一致；后续刷新可能再次跳变。未观察到字幕数据损失。

**建议：** 在设置读取与写入边界增加同账号的版本/时序保护，使写入前发出的陈旧查询不能覆盖写入结果，同时保留后续有效远端刷新。测试应涵盖「旧 GET 延迟至语言 PATCH 成功后返回」，不能只验证连续语言 PATCH 或账号切换。

### F3 · P2 · 剪贴板中的孤立 Unicode surrogate 触发未处理异常和 HTTP 500

**位置：** `backend/ass_format/clipboard.py:45`。

**触发场景：** `/api/ass/clipboard` 的 JSON `text` 为孤立 surrogate，例如 JSON 转义字符串 `"\ud800"`。JSON 解码允许得到该 Python 字符串，但它不能以默认严格模式编码成 UTF-8。

**证据与原因：** `paste_lines()` 在字节数校验中直接调用 `text.encode('utf-8')`，没有处理 `UnicodeEncodeError`。异常发生在后续 ASS 校验之前，不能利用 codec `_inspect` 已有的 Unicode 错误转换；接口的格式错误处理也不能捕获它，最终变成通用 500。

**实际验证：** 对 `empty_document()` 调用 `paste_lines(document, '\ud800', None, [], None)` 得到 `UnicodeEncodeError`，且不是 `AssError`。再用 Django Client 发送真实接口请求，得到 HTTP 500 与 `server_error / server.serviceUnavailable`。验证中将数据库游标执行替换为抛错，确保此请求没有执行 SQL。

可在仓库根目录复现（不需要数据库）：

```bash
PYTHONPATH=backend DJANGO_SETTINGS_MODULE=application.test_settings .venv/bin/python - <<'PY'
import json
from unittest.mock import patch
import django
django.setup()
from django.test import Client
from ass_format import empty_document

payload = {
    'document': empty_document(), 'text': '\ud800',
    'active_id': None, 'ids': [], 'fields': None,
}
with patch('django.db.backends.utils.CursorWrapper.execute',
           side_effect=AssertionError('No SQL allowed')):
    response = Client(raise_request_exception=False).post(
        '/api/ass/clipboard', data=json.dumps(payload),
        content_type='application/json',
    )
print(response.status_code, response.json())
PY
```

**影响：** 可预期的无效输入变成服务错误，用户收到无关的「服务暂时不可用」提示并产生异常日志。没有证据表明这会造成持久化数据损失、越权或持续性服务中断。

**建议：** 在文本字节校验处捕获 Unicode 编码错误，返回现有格式错误契约的 422；增加 surrogate 输入回归，同时保留正常中文、emoji 及字节上限测试。

## 实际验证结果

以下均在本次执行，不以已有报告代替执行结果。前端命令在 `frontend/`，Python 命令在仓库根目录运行。

| 验证 | 实际结果 |
| --- | --- |
| `npm test -- --run`（含 pretest `i18n:check`） | 56 个测试文件、481 项测试通过；包含相对依赖环与 diagnostics 边界检查 |
| `npm run typecheck` | 通过 |
| `npm exec vite build -- --outDir /tmp/cuerelay-review-1116-dist` | 通过；有 bundle 超过 500 kB 的提示，未据此提出风格/性能缺陷 |
| `npm run test:ass-compatibility` | 通过；覆盖既有 F1–F4/R1–R3、ASCII 数字/填充、模型与渲染样式身份、4 个语料 glyph 图像往返 |
| Python `unittest discover -s scripts -p 'test_*.py'` | 5 项通过 |
| 后端纯格式/HTTP/QC/兼容性/快捷键/诊断测试集合 | 97 项通过 |
| `CUERELAY_TEST_PGPORT=55433 .venv/bin/python backend/manage.py test accounts ass_format http_api organizations projects diagnostics --settings=application.test_settings --noinput -v1` | 209 项：208 通过，1 项因无 Nginx 跳过；Django system check 无问题 |
| 同一隔离配置下 `makemigrations --check --dry-run` | 通过，`No changes detected` |
| `browser_tests.regression`，真实临时 PostgreSQL + 浏览器 | 7 项通过，43.175 秒；浏览器输出目录单独重定向到 `/tmp` |
| `GLOSSARY_URL=http://127.0.0.1:5279 node browser-tests/glossary.mjs` | 通过，无页面错误或意外请求 |
| `VIDEO_RESTORE_URL=http://127.0.0.1:5279 node browser-tests/video-restore.mjs` | 8 项检查通过，Chromium 147.0.7727.101 |
| `SUBTITLE_QC_URL=http://127.0.0.1:5280 node browser-tests/subtitle-qc.mjs` | 通过，18 次 inspect、含 5000 行检查，无页面错误/意外请求 |
| 两个生产构建定向浏览器探针 | F1、F2 按上述响应顺序复现；这两项验证的是缺陷存在，并非功能通过 |
| 剪贴板纯函数与 Django Client 探针 | F3 复现为 `UnicodeEncodeError` / HTTP 500，无 SQL |
| 后端生产模块 AST import 图（排除测试/迁移） | 未发现模块环；未确认新增跨层边界违规 |
| `git diff --check 0f9b1e0` | 非零；默认设置报告 CRLF/空白。启用 `core.whitespace=cr-at-eol` 后，剩余为第三方许可证文本的尾随空白/文件末空行，未修改或作为问题列出 |

真实数据库浏览器回归覆盖：保存后刷新与历史、版本冲突保留本地修改、项目样式刷新重试、工作区保存合并样式、远端删除样式后历史恢复保护、组织术语表分叉隔离、切英文后编辑状态与保存。

QC 脚本首次针对生产 preview 执行时，在最终动态导入 `/src/subtitle-qc/check-subtitles.ts` 处失败：preview 不提供源模块。随后按该脚本需要改用 Vite dev server，完整通过；不将首次环境失败解释为产品缺陷。

后端验证最初受沙箱网络和未运行测试数据库限制；检查隔离配置后，使用本机 PostgreSQL 运行时创建了全新的 `/tmp/cuerelay-review-1116-pg.gyFTiT` 集群，测试数据库由 Django 创建/销毁。未使用 `.env` 或现有开发数据。清理时确认该临时集群已停止。

临时证据文件包括 `/tmp/cuerelay-review-1116-{frontend,backend,e2e,build,libass,pure,glossary-browser,video-browser,qc-browser-dev}.log` 和 `/tmp/cuerelay-review-1116-browser.mjs`。它们可能被系统清理，故关键复现顺序及结果已保留在本报告。

## 覆盖重点与剩余范围

本次重点检查了此前报告之后的新变更及模块交界：国际化偏好与会话观察、结构化消息与后端异常、QC 与导出、剪贴板与格式校验、项目保存/样式版本重试与撤销历史、组织/项目术语表权限及复制、视频恢复、音频试听生命周期、行命令/搜索/虚拟列表，以及迁移与发布配置。已检查相关接口、实现和测试；未发现需另外列出的已证实架构边界问题。

以下不属于本次已验证结论：

- Nginx 实际反向代理、生产部署/TLS；相关 Nginx 测试被跳过。
- Firefox、Safari、Windows、移动端、真实原生文件选择器的全部授权行为。
- 长时间、高采样率、多声道真实媒体的 GPU/原生内存表现，以及真实网络延迟下的预览 RTT。既有性能报告的 F3/F6 未获得新的完整验收证据。
- 完整多语言视觉布局验收、所有三语言组合及全部旧浏览器脚本；本次执行的是上述定向脚本与真实后端七场景。
- 所有故障与并发排列，包括写入成功但响应丢失等所有交错；通过的正常流程测试不能排除本报告复现的竞态。
- 锁文件、生成消息目录、第三方许可证/字体/WASM 实现未逐行穷尽审计。文件清单纳入范围，深入检查按行为风险选取，不声称 446 个 tracked 改动文件与 79 个未跟踪文件的所有执行分支均已覆盖。

没有为完成本次 review 扩大实现范围或做架构重构；修复建议仅指向上述可复现缺陷。
