# 未提交改动审查

审查日期：2026-10-30。范围：当前工作区相对 HEAD 的全部未提交改动，包括未跟踪的诊断模块及测试；暂存区无改动。按只读方式审查，唯一新增文件为本报告，没有修改业务代码或测试。

发现 **2 个 P2 问题**，均已通过直接加载当前源码的独立脚本复现。建议修复后再合入。

## 1. [P2] 身份确认取消批写定时器后，需要清空句柄

**位置：** [frontend/src/diagnostics/recorder.ts:51](/Users/wezy/Documents/code/CueRelay/frontend/src/diagnostics/recorder.ts:51)，与同文件第 76 行的定时器创建条件共同触发。

`identify()` 调用 `clearTimeout(this.timer)` 后没有将 `this.timer` 设回 `undefined`。后续 `record()` 只有在 `!this.timer` 时才安排批写，因此被取消的句柄会永久阻止这一 recorder 的自动批写。

这会出现在正常启动路径：`diagnosticFetch('/api/auth/session')` 先记录请求并启动两秒定时器；若会话在两秒内返回，`createAccountApi` 随即调用 `identify()`，取消该定时器。后续编辑和请求仍进入内存，但不再按文档约定每两秒写入 IndexedDB。手动导出能触发 `collect()` 写入，却不会修复后续定时调度；页面退出时的异步写入也不能替代正常批写。页面崩溃可能丢失整个会话的诊断，而不只是最后一批。

**实际复现：** 使用当前 `DiagnosticRecorder` 和统计 `batch()` 调用次数的内存存储适配器，执行：

```text
record(http/request/start)
await identify(1)
record(editor/edit/changed)
等待 2250ms
```

结果为 `batchCalls=0, persistedRows=0`；随后手动 `collect()`，才变为 `batchCalls=1, persistedRows=1`。

**最小修正建议：** 在取消定时器时同步清空句柄，让新身份下的下一条记录可以重新调度。增加“先产生记录、再确认身份、继续记录、不调用 collect/flush”的定时持久化回归，同时覆盖账号切换。

## 2. [P2] 异步错误应保留操作开始时的账号代次和页面上下文

**位置：** [frontend/src/diagnostics/errors.ts:13](/Users/wezy/Documents/code/CueRelay/frontend/src/diagnostics/errors.ts:13)，相关调用实例为 [frontend/src/project-ui/ProjectSettingsPage.tsx:46](/Users/wezy/Documents/code/CueRelay/frontend/src/project-ui/ProjectSettingsPage.tsx:46)。

`reportFailure()` 默认在错误到达时读取 `diagnostics.scope()`，且没有接收原始 `Context` 的参数，最终 `record()` 使用报告时的当前页面。项目设置、成员面板、个人设置及样式面板等异步 `catch` 直接调用该函数，没有捕获操作开始时的身份或页面上下文。

例如，在组织 A 的项目设置中发起保存，响应尚未返回时导航到组织 B 的页面；旧请求稍后失败，`handled_error` 就会被写成 B 的事件。若期间确认了另一账号，旧错误也能以新账号代次进入记录，绕过 recorder 对旧 scope 的过滤。底层 HTTP 包装虽然保留了原始 scope/context，但上层的这条错误记录仍会重新引入错误归属，导致当前组织的导出出现其他组织的请求编号和错误，并误导摘要。

**实际复现：** 直接加载当前 `diagnostics` 和 `reportFailure`，按现有调用方式为延迟 Promise 注册 `catch`；操作开始时为账号 1、组织 1、项目 11，随后确认账号 2 并切至组织 2、项目 22，再拒绝原 Promise。为隔离持久化因素，使用模块支持的内存降级模式。实际导出包含：

```json
{
  "startScope": 1,
  "endScope": 2,
  "exportedEvents": [{
    "module": "project-ui",
    "context": {
      "page": "project-settings",
      "organizationId": 2,
      "projectId": 22
    },
    "requestId": "11111111-1111-4111-8111-111111111111"
  }]
}
```

这是诊断事件归属和隔离缺陷；本次没有证明字幕正文或认证凭证通过此路径泄露，也不涉及原保存事务被重复执行。

**最小修正建议：** 异步操作开始时捕获 scope 和 context，让 `reportFailure()` 显式接收并传递两者；账号已变化时丢弃旧事件，同账号切页时保留原组织/项目归属。补充“延迟请求失败前切组织”和“失败前切账号”的调用端回归，不能只测试 recorder 接收到正确旧 scope 时的行为。

## 本次验证

| 检查 | 结果 |
| --- | --- |
| `cd frontend && npm test -- --run` | 36 个测试文件、322 项通过，包含相对源码依赖无环及 diagnostics 叶子边界检查 |
| `cd frontend && npm run typecheck` | 通过 |
| `DJANGO_SECRET_KEY=review-only-not-a-production-secret .venv/bin/python backend/manage.py test diagnostics.tests.DiagnosticTests accounts.test_shortcuts --noinput` | 9 项通过，系统检查通过；不使用业务数据库 |
| 两个独立时序复现脚本 | 均复现上述问题；通过 Vite SSR 加载当前源码，没有增加或修改仓库测试 |
| `git diff --check` | 通过 |

本次未重跑真实浏览器端到端测试、数据库集成测试或生产构建；仓库已有实验记录中的通过结果不作为本次执行结果。未发现可确认的新循环依赖或业务模块反向依赖；字幕焦点绑定改动未发现其他可操作缺陷。

## 修复复核（2026-10-30）

两项均属实且值得修改，已完成修复；没有不采纳项。原报告保留为修复前事实记录。

| 条目 | 判断与处理 |
| --- | --- |
| 1. 取消批写定时器后未清空句柄 | 确认会阻止整段会话的自动持久化。`identify()` 取消定时器后重置句柄；新增假时钟测试直接检查存储批写，不依赖手动 `flush/collect`，覆盖首次身份确认和账号切换。测试在旧实现上以 batch 调用次数为 0 失败，修复后通过。 |
| 2. 异步错误使用报告时的身份/页面 | 确认与既有隔离契约冲突。新增操作起点的 `captureDiagnosticOrigin()`；`reportFailure` 必须显式接收 scope/context，更新账号、项目、样式及编辑器全部调用端。旧账号错误由 recorder 丢弃，同账号切页错误保留原页面/组织/项目；导入完成事件也复用该 origin。 |

本次实际验证：

- `cd frontend && npm test -- --run`：36 个测试文件、323 项通过，包含自动批写回归和相对依赖无环/诊断叶子边界检查。
- `cd frontend && npm run typecheck`：通过。
- 启动干净 Vite 进程（5194 端口）后执行 `cd frontend && npm run test:diagnostics`：原有真实 Chrome 诊断导出/IndexedDB/身份隔离测试及新增 `diagnostics-errors.mjs` 全部通过。新测试从真实项目设置页发起 PATCH，延迟失败前通过 UI 切组织或通过会话观测确认另一账号；检查实际组件 catch 的起点信息、组织过滤、原组织归属及旧账号事件丢弃。
- `git diff --check`：通过。

未修改后端或数据模型，本次未重跑后端测试、数据库集成测试或生产构建。模块依赖方向不变。执行计划见 [修复计划](../plans/workspace-review-fixes-2026-10-30.md)。
