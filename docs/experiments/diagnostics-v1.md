# 诊断 v1 验证记录

2026-10-30，macOS、本机 Chrome（Playwright channel=chrome）、Node 26、Vite、Django 与隔离 PostgreSQL 测试库。未发布生产，未自动上传诊断或修改开发业务数据。保留任务开始时已有的未提交改动。

## 实际执行

| 检查 | 命令 / 入口 | 结果 |
| --- | --- | --- |
| 前端纯测试 | `cd frontend && npm test -- --run` | 最终 322 项 / 36 文件通过；含安全投影、序号/保留/预算、账号代次、异步批次竞态、时钟回拨、错误分类、编辑差异及既有回归 |
| 类型 / 生产构建 | `cd frontend && npm run typecheck`；`npm run build`（再次包含 tsc） | 通过 |
| 后端相关契约 | 加载 .env 后 `.venv/bin/python backend/manage.py test diagnostics http_api.tests http_api.test_identity projects.tests projects.test_splitting --noinput` | 57 项通过；独立测试数据库创建/销毁，无系统检查错误 |
| Chrome 诊断回归 | 干净 Vite 5194，`npm run test:diagnostics` | 通过；最终产物目录见下 |
| Chrome 编辑历史回归 | `HISTORY_URL=http://127.0.0.1:5194/workspace/local npm run test:workspace-history` | 通过；本地与项目、保存 CAS/revision、拆分成功/失败、稳定 UUID、实例保留/替换 |
| 依赖与格式 | 相对 TypeScript import 图检查；最终固化为 diagnostics/boundaries.test.ts；`git diff --check` | 无本地循环导入；diagnostics 无业务模块导入；无空白错误 |

诊断浏览器测试使用隔离 HTTP fixture（不向开发数据库保存）和真实 Chrome IndexedDB/下载/输入/Worker；后端测试单独使用真实 Session、CSRF、项目服务与数据库事务，关联同一请求编号。

最终 Chrome 诊断产物：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-diagnostics-AqxQae`（合成无音轨视频与工具栏截图）。历史产物：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-history-FTBbL0`。临时目录可能由系统清理；验证脚本留在仓库可重跑。

## 已验证场景

- 初始会话请求长期等待时仍有可用导出入口；一键下载带缩进的有效 JSON，键顺序为 summary/environment/events/metadata；摘要根据真实错误、冲突、未知响应与未保存状态派生，不生成根因。
- 连续输入、Chrome CDP IME、粘贴正文，失焦及导出前仍在诊断缓冲的正文正确进入逐行差异；导出不改当前正文、撤销/重做结果或正在播放的视频。
- 已有历史全套实际输入、拖动、重复方向键、IME、原生撤销、样式、提交/删除、保存/拆分/revision 和账号/组织/项目切换通过。
- HTTP 409 有相同 requestId 的开始与完成；后端真实 CSRF 403、未认证 401、成功 200 和真实 revision 冲突 409 均可按编号查询。真正未处理异常即使 DEBUG 也只返回通用 500；安全栈保留在服务端。
- 断网（请求 abort internetdisconnected）仍可在页面内导出，结果为 unknown/no_response_result_unknown，不断言服务端未提交；browserOnline 与 serverReachability 分开。
- 真实无音轨视频的 Worker 已处理错误具有 audio-analysis 模块/阶段、安全类型及源码位置，不包含媒体字节/文件名/摘要。Worker error/messageerror 边界也已接入；未对所有浏览器 Worker 崩溃模式做实机穷举。
- 刷新后已写入正文继续可读；1800 条输入淘汰到最多 1500 条，新的 recorder 从真实 IndexedDB 读取相同有界记录并保留最后一条。纯测试另覆盖 2MiB/16KiB/24 小时和时钟回拨。
- 禁用 BroadcastChannel 后，新标签页切到另一账号，旧标签页仍由 IndexedDB fence 拒绝导出旧正文/工作区；纯测试覆盖旧异步结果和不同组织过滤。
- IndexedDB 完全不可用时仍能编辑、经可用通知通道隔离，并导出内存正文；模拟 QuotaExceededError 写入失败时，只读身份检查仍工作，内存可导出。两种协调方式都失败时，纯测试确认正文和工作区保守隐藏。
- 下载 createObjectURL 故障显示简短重试提示；恢复后同一记录仍可导出。
- 请求/错误的密码、凭证、Cookie/CSRF/Authorization、租约 token、文件路径和媒体摘要测试字符串不进入最终记录；没有任意页面输入、请求/响应体或 console 采集。字幕业务正文仍默认采集。

## 过程中修正

中间件最初把 Django PermissionDenied 归为通用 500，原账号集成回归发现后改为保留正常 4xx，57 项最终重跑通过。导出与在途批次之间增加有界的第二次刷新，并有独立竞态测试。

真实浏览器测试动态导入源码以直接验证 recorder。编辑诊断模块后，Vite HMR 可能使带时间戳和不带时间戳的导入属于不同模块代次；测试应在完成代码修改后启动干净 Vite 进程，运行期间不要热更新源码。最终预算持久化检查在干净进程通过，不把热更新期间的错误实例当成持久化成功。

## 已知限制

只覆盖近期有界记录，正文长字段可截断；不是审计、备份或可重放文档。崩溃最后一批不保证落盘，Safari/Firefox 和真实磁盘耗尽仍待实机验收。浏览器无法证明服务器可达或请求是否提交；维护者需结合请求编号与实际 revision 检查。构建标签未配置时明确 unknown。刷新且后端不可用时无法确认身份，不读取此前账号正文；当前页面已有浏览器信息仍可导出。应用之外的账号变化在现有会话检查观测之后才能识别。

默认服务端 stderr 的生产轮换依赖部署管理器配置；单进程可启用仓库提供的 5MiB × 4 文件轮换。未实际部署或验证生产 Nginx/systemd/journald 配置。仓库中既有不相关的架构/快捷键改动未清理或提交。
