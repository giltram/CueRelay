# 工作区内存历史验证

日期：2026-10-30。开始时工作树干净；实现计划见 [workspace-history](../plans/workspace-history.md)，公开模块契约见 [workspace-ui](../../frontend/src/workspace-ui/README.md)。

## 实际执行结果

- `cd frontend && npm run typecheck`：通过。
- `cd frontend && npm test -- --run`：30 个测试文件、296 项通过。历史测试包含原始非法时间、选择/草稿、提交 UUID、删除空文档、交错文字/样式、分组/无变化、重做分支和 100 步上限；拖动/输入回到原值不会消耗历史或丢失原分支。
- `cd frontend && npm run build`：通过（tsc + Vite）。
- `python backend/manage.py test accounts.test_shortcuts http_api.test_identity --noinput`：20 项通过；随后新增 API 兼容用例，以 `http_api.test_identity.IdentityTests.test_history_shortcuts_preserve_legacy_overrides_and_reject_explicit_conflicts` 单独执行通过，共 21 项。使用 Django 自动创建/销毁的独立 PostgreSQL 测试库，不写开发业务数据。
- `npm run test:workspace-history`：真实 Chrome/FFmpeg 通过。最后一次输出目录为 `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-history-CIOdhn`。接口由隔离 fixture 提供，拆分/样式调用真实 Python 纯转换。
- `EDITING_URL=http://127.0.0.1:5189/workspace/local npm run test:editing-operations`：既有裁剪/拆分浏览器回归通过，包括项目 CAS、失败保护、文本光标、IME 与鼠标偏好。
- `SUBTITLE_FOCUS_URL=http://127.0.0.1:5189 npm run test:subtitle-focus`：既有 Tab、光标、输入框/IME、弹窗、忙碌、全屏保护回归通过。
- 对 114 个前端 TS/TSX 模块的相对 import/from 依赖进行 DFS（包含 type imports）：无循环。新增方向是工作区编排 → hook → 纯历史 → contracts；音频、媒体与持久接口均不反向依赖历史。`git diff --check` 通过。

## 真实浏览器覆盖

1. Ctrl/Cmd+Z、Shift+Z；一次多段拖动只撤销一步，中途撤销使旧捕获后续移动失效；pointercancel/lostpointercapture 保留最后结果并结束分组。
2. 方向键单按与 repeat 分组；文本连续输入与超过 1 秒停顿分组；CDP Chrome IME 合成跨越 1 秒仍是一组。
3. G 提交/自动新增原子恢复，重做 UUID 稳定；删除恢复原选择及非法草稿，支持删空。
4. 文本、时间、字幕样式、本地样式复制/分配交错撤销；弹窗、待确认导入保护；失败校验/导入保留历史，成功导入建立新基线。
5. 实际原生 historyUndo/historyRedo 输入事件（macOS 使用 Cmd），验证安全新基线、原生重做保留、工作区恢复后旧原生重做不能重放。
6. 撤销停止试听，视频位置/音频视窗保持；手动保存后撤销再保存使用最新 revision；项目拆分成功后本地撤销无反向请求、再次保存使用最新 revision，拆分失败保留内容和历史。
7. 隐藏工作区不响应 Z、返回保留原 video 和历史；刷新/显式重载、项目、组织和批准的账号替换创建新实例，旧历史不可跨越。

## 验证边界

完整既有 `test:audio-timeline` 曾尝试执行，但其真实登录流程要求隔离测试库的 `BROWSER_TEST_PASSWORD`，本次未提供，故未完成。新增历史套件和既有编辑/焦点套件使用隔离 HTTP fixture，覆盖本次改动涉及的音频交互；不将完整音频套件计为通过。

本次真实浏览器为 macOS Chrome（既有焦点脚本报告 147.0.7727.101）；没有声称完成 Safari/Firefox 或原生输入法候选窗口的人工验收。IME 使用 Chrome CDP 的真实 composition/input 管线。

原生输入撤销/重做会清空旧工作区历史并建立新基线，这是明确的安全边界。仅 100 步实例内内存历史，无跨刷新、多用户撤销或自动保存。服务端 revision 和保存基准始终独立，不随着 Z 回退。
