# 自动化回归测试

从仓库根目录运行本页命令。测试不需要 `.env`、生产密钥、开发账号或开发数据库。环境要求同根目录 README：Python 3.11、Node 26、npm、FFmpeg；数据库可用 Docker Compose 启动专用 PostgreSQL 16。真实代理回归另需 Nginx。

## 全新克隆准备

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci --prefix frontend
cd frontend
npx playwright install chromium
cd ..
docker compose -f compose.test.yml up -d --wait
```

Linux 浏览器系统库可用 `cd frontend && npx playwright install --with-deps chromium` 安装；FFmpeg/Nginx 使用系统包管理器安装，例如 Ubuntu 的 `sudo apt-get install ffmpeg nginx`，macOS 的 `brew install ffmpeg nginx`。非 PATH 中的 Nginx 可通过 `NGINX_BINARY=/absolute/path/to/nginx` 指定。不要把路径设置成不存在的文件。

若不用 Docker，可在**另建的本机临时集群**提供 `127.0.0.1:55433`，创建 `cuerelay_test`（密码 `cuerelay-test-only`，允许 CREATEDB）及默认维护库 `postgres`；不要复用生产集群。端口冲突可在当前 shell `export CUERELAY_TEST_PGPORT=55434`，Compose 和测试配置同步采用此端口。测试配置固定 loopback/测试角色、忽略普通 `PG*` 变量；不读取 `.env`。这些固定凭据只能用于此本机一次性测试集群。

## 运行

后端全部既有回归（真实 PostgreSQL，包括多连接竞争、迁移和 HTTP 权限）：

```sh
.venv/bin/python backend/manage.py check --settings=application.test_settings
.venv/bin/python backend/manage.py makemigrations --check --dry-run --settings=application.test_settings
.venv/bin/python backend/manage.py test accounts ass_format srt_format http_api organizations projects diagnostics --settings=application.test_settings --noinput -v 2
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

未安装 Nginx 时，既有 `http_api.test_proxy_limits` 会明确报告 1 项 skip；完整验收和 CI 必须安装后运行，不将其记为通过。不要用 SQLite 代替 PostgreSQL 锁/事务测试。

前端快速回归、独立 ASS 引擎和构建：

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run test:ass-compatibility
npm run build
cd ..
```

`test:ass-compatibility` 复用仓库 `.venv` 的 Python codec 和真实 JASSUB WASM；不需要浏览器、服务或数据库。构建及首次启动 Vite 会校验许可材料，首次联网下载约 80MB 固定校验和的依赖源码，之后复用 `.open-source-cache`；不能通过删除许可材料步骤来让测试通过。

首轮真实浏览器回归：

```sh
.venv/bin/python backend/manage.py test browser_tests.regression --settings=application.test_settings --noinput -v 2
```

入口选择检查已纳入上面的 `scripts/test_*.py`，也可单独运行：

```sh
.venv/bin/python -m unittest scripts.test_regression_selection -v
```

该检查需要已安装的前端依赖；读取 Django 入口的显式 `run_browser` 字符串，并用真实 Playwright `--list --grep` 逐个检查：每个入口只选一个场景，全套入口与所有发现的场景一一对应，无漏选或重复。包括嵌套 describe 中的场景，不启动 Django/Vite/Chromium 或数据库；占位的 loopback URL 和空夹具仅供发现用例，不执行场景。

草稿相关入口保留原名称：`test_workspace_draft_local` 仅运行导入/导出/刷新/放弃，诊断另由 `test_workspace_draft_local_timing_diagnostics` 运行；`test_workspace_draft_leave` 运行已保存项目退出组织失败/成功；`test_workspace_draft_leave_delete_failure` 的当前场景是放弃未保存草稿返回首页并报告本地删除失败，不再播种额外组织或执行退出组织。

2026-11-21 本次入口修复验证：选择检查在修复前复现两处零匹配及本地草稿入口选中两例，修复后确认当前 33 个 Django 入口与 33 个 Playwright 场景一一对应；脚本 unittest 全部 6 项通过。四个受影响场景首次真实运行 3 项通过、1 项失败，定位为普通成员夹具不应断言管理者的「新建项目」按钮，改为验证原项目链接仍可见。随后以下命令在新建的 `/tmp` PostgreSQL 16.2 集群中 4/4 通过（26.279 秒），每次 Playwright 均报告 `Running 1 test`，无重试/跳过。使用 Python 3.11.8、Node 26.4.0 和仓库 Playwright 1.62.1 对应的 Chromium；Django 销毁测试数据库后停止临时集群。Docker socket 和沙箱共享内存/监听限制通过独立本机集群及执行权限解决，未接触开发/生产数据库，未执行完整 33 场景浏览器回归。Python 编译、修改的浏览器脚本语法及 `git diff --check` 均通过；产品依赖和行为不变，GitHub Actions 继续暂停。

```sh
.venv/bin/python backend/manage.py test \
  browser_tests.regression.WorkspaceRegressionTests.test_workspace_draft_local \
  browser_tests.regression.WorkspaceRegressionTests.test_workspace_draft_leave \
  browser_tests.regression.WorkspaceRegressionTests.test_workspace_draft_leave_delete_failure \
  browser_tests.regression.WorkspaceRegressionTests.test_workspace_draft_local_timing_diagnostics \
  --settings=application.test_settings --noinput -v 2
```

上述实际运行通过 `CUERELAY_TEST_PGPORT` 指向临时集群的独立 loopback 端口；复验时按本页准备专用测试集群。

2026-11-21 **本次完整 33 场景首轮**（北京时间 20:08:26–20:12:18，与上面的历史四例复验分开）：先执行 `.venv/bin/python -m unittest scripts.test_regression_selection -v`，选择检查通过（9.435 秒），确认 33 个 Django 入口与 33 个 Playwright 场景一一对应。随后通过新的临时编排脚本 `/private/tmp/cuerelay-run-full-regression-20261121.py` 实际执行：

```sh
CUERELAY_TEST_PGPORT=64215 .venv/bin/python backend/manage.py test browser_tests.regression --settings=application.test_settings --noinput -v 2
```

| 首轮统计层次 | 通过 | 失败 | 错误 | 跳过 |
| --- | --- | --- | --- | --- |
| Playwright 场景 | 32 | 1 | 0 | 0 |
| Django 入口（浏览器非零退出记为 error） | 32 | 0 | 1 | 0 |

**本次未达到 33/33 全部通过。** Django 报告 `Ran 33 tests in 231.285s`、`FAILED (errors=1)`，命令耗时 232.134 秒、退出码 1。33 个入口均实际执行且各自报告 `Running 1 test using 1 worker`；失败后继续完成其余场景，没有重试、跳过或重跑。

唯一失败为 `test_conflict_preserves_local_edits` / `conflict preserves local edits`：`frontend/regression/workspace.spec.mjs:31` 的 `verifyVideo` 断言字幕文本框可编辑超时（调用点 `:301`）。trace 显示选片、选行后再次加载工作区 HTML，Vite 重连，`react-dom_client` 依赖 hash 从 `743b71aa` 变为 `45d08918`；截图中视频与选择均已清空，尚无 document 保存请求。证据指向首次 Vite 依赖优化引发整页重载的环境/编排问题；触发源仍属推断，未做冷缓存对照或重跑确证，冲突保存流程本次尚未验证。未修改产品或测试断言求通过，该启动稳定性问题仍待单独处理。

环境为 macOS 14.8.5 arm64、Python 3.11.8、Django 5.2.18、Node 26.4.0、PostgreSQL 16.2、FFmpeg 9.0.2、Playwright 1.62.1 / 配套 Chromium revision 1234（151.0.7922.34）。全新集群位于 `/private/tmp/cuerelay-full-regression-hwwcb6b7/data`、仅监听 loopback 64215，Django 创建 `test_cuerelay_74342`；未加载 `.env`，未接触开发/生产数据库，未使用 `keepdb`。沙箱预备尝试在动态端口绑定前被阻止（证据目录 `/private/tmp/cuerelay-full-regression-14az72rq`），经执行权限机制启动上述新集群；预备尝试未启动 Django，不计入首轮。结束后数据库清单仅有 `postgres/template0/template1`；`pg_ctl stop` 成功、`pg_ctl status` 为 3（无服务）、`postmaster.pid` 已移除。

完整证据保留于 `/private/tmp/cuerelay-full-regression-hwwcb6b7/`：[33 场景逐项汇总](/private/tmp/cuerelay-full-regression-hwwcb6b7/run-summary.md)、[CSV](/private/tmp/cuerelay-full-regression-hwwcb6b7/scenario-results.csv)、[完整 Django 日志](/private/tmp/cuerelay-full-regression-hwwcb6b7/django.log)、`selection.log`、`scenario-logs/`、`metadata.json`（命令/耗时/原文件哈希/清理结果）、`artifact-sha256.json`；失败的 [trace](/private/tmp/cuerelay-full-regression-hwwcb6b7/test-results-after/conflict-preserves-local-edits/workspace-conflict-preserves-local-edits/trace.zip)、截图及错误上下文均在 `test-results-after/conflict-preserves-local-edits/workspace-conflict-preserves-local-edits/`，提取时间线为 `first-failure-timeline.json`。旧浏览器证据已另存 `test-results-before/`。运行前后五项既有未提交文件哈希一致；本任务仅追加本验证记录，未提交代码、未启用 GitHub Actions。

### 2026-11-22 冲突场景失败诊断（独立对照，不改写首轮）

已复现并确认触发链是 **Vite 开发服务器在交互后发现 Worker 依赖，重新优化并整页重载**。首轮冲突例恰为 Django 按名称排序后的第一例；每个 `run_browser` 都新启 Playwright/Vite，但默认共用 `frontend/node_modules/.vite`，因此后续场景可受益于前例留下的优化结果。Playwright 的 `webServer.url` 只确认首页 HTTP 可用，不保证尚未启动的 Worker 依赖已经预优化；默认 `holdUntilCrawlEnd: true` 也只等待当时的静态导入遍历。

选片经 `media-manifest.hashFile → file-hash.worker → file-hash` 首次请求 `@noble/hashes/sha2.js`；片源通过校验后，`use-audio-analysis → audio.worker → segment-store → spectrum` 又首次请求 `fft.js`。本机 Vite 8.3.5 的初始扫描未包含这两项，默认 `vite.config.ts` 也未显式 include。冷缓存对照记录到 `new dependencies found: @noble/hashes/sha2.js`，既有 `react-i18next` 的 `fileHash` 变化（配置/锁文件总 hash 未变、无 interop mismatch 警告），随后 `runOptimizer → fullReload` 向客户端发送 `{type: 'full-reload', path: '*'}`；调用栈、发送时的优化元数据均保存在 `vite-events.jsonl`。Vite 客户端处理该消息后重新载入 HTML，内存中的 File/选行清空，可编辑门禁因而关闭。React DOM URL 的 browser hash 变化是整个优化批次失效的表现，不代表 React DOM 业务代码本身发生修改。机制可核对本机 `node_modules/vite/dist/node/chunks/node.js` 的 `runOptimizer/fullReload` 与 `dist/client/client.mjs`，以及 [Vite 依赖预构建说明](https://vite.dev/guide/dep-pre-bundling.html) 和 [依赖优化选项](https://vite.dev/config/dep-optimization-options.html)。

首轮 trace 中选片为 4426.637ms、哈希 Worker 为 4645.560ms、sha2 请求为 4657.142ms、选行完成为 4669.784ms、再次请求工作区 HTML 为 4873.668ms；后者之前没有第二次 `page.goto`、第二页面或任何 document PUT。原始 trace 未保存 HMR 消息、优化器日志及运行前缓存元数据，因此无法逐字还原首轮缓存的来源和全部内容；以下受控复现将相同症状与实际优化器重载调用栈连在一起，而非仅凭 Vite 重连作判断。

四组均运行**原始同一场景/夹具/断言**，每组独立新建 PostgreSQL 集群和 Django 测试库，各执行一次，无自动重试：

| 独立条件 | 结果（Django 报告耗时） | 优化器 full-reload | document PUT 状态 |
| --- | --- | --- | --- |
| A：空隔离缓存、默认优化配置 | 失败，16.698s；同一 `workspace.spec.mjs:31` | 1，新增 sha2 后触发 | 无 |
| B：复用 A 生成的热缓存、默认优化配置 | 通过，7.120s | 0；日志确认缓存 hash 一致 | 200、409、409 |
| C：另一空缓存，仅 include sha2 | 失败，64.835s；`:311` 填写本地稿超时 | 1，新增 FFT 后触发 | 200 |
| D：另一空缓存，include sha2 和 FFT | 通过，9.068s | 0；无运行中新增依赖 | 200、409、409 |

B/D 均完整验证了远端保存、真实 revision 冲突、本地正文/非法时间草稿保留、备份导出、取消与明确重载，并通过既有未捕获页面错误检查。C 说明仅补 sha2 会把失败推迟到音频分析启动，不能作为完整修复。

复验编排为 `/private/tmp/cuerelay-diagnose-conflict.py`，归档副本及解析器、结构化结果见 [诊断汇总目录](/private/tmp/cuerelay-conflict-diagnosis-20261122/summary.json)。实际命令（A 必须使用新的空目录；B 刻意复用 A 的隔离缓存，C/D 各用另一空目录）：

```sh
.venv/bin/python /private/tmp/cuerelay-diagnose-conflict.py --label cold --cache /private/tmp/cuerelay-conflict-isolated-cache-20261122
.venv/bin/python /private/tmp/cuerelay-diagnose-conflict.py --label warm --cache /private/tmp/cuerelay-conflict-isolated-cache-20261122
.venv/bin/python /private/tmp/cuerelay-diagnose-conflict.py --label cold-include-sha2 --cache /private/tmp/cuerelay-conflict-include-sha2-cache-20261122 --include @noble/hashes/sha2.js
.venv/bin/python /private/tmp/cuerelay-diagnose-conflict.py --label cold-include-workers --cache /private/tmp/cuerelay-conflict-include-workers-cache-20261122 --include @noble/hashes/sha2.js,fft.js
```

临时诊断 runner 只替换 `WorkspaceRegressionTests.run_browser` 的启动配置路径和证据输出目录，仍执行 `test_conflict_preserves_local_edits`。临时 Playwright 配置导入原配置，保留 `retries: 0`、原超时和 Chromium，改为保留所有 trace、转发服务日志；临时 Vite 启动器用公开 `createServer` API 加载仓库配置，指定 `envFile: false`、独立绝对 `cacheDir` 和原 loopback 5199，仅在 C/D 覆盖 `optimizeDeps.include`，被动记录请求/优化元数据及 `client.hot.send` 调用栈。复建此实验时按此设置临时启动器，不能复用这些已变热的目录来声称冷启动。其余数据库准备/销毁及原测试入口契约仍按本页执行。

证据目录依次为 `/private/tmp/cuerelay-conflict-cold-qwofk5f2/`、`/private/tmp/cuerelay-conflict-warm-_ooshvqn/`、`/private/tmp/cuerelay-conflict-cold-include-sha2-ehecbt37/`、`/private/tmp/cuerelay-conflict-cold-include-workers-z6kru7p1/`；均含启动器、Django/Vite 日志、trace、`diagnostic-timeline.json`、`vite-events.jsonl` 和清理元数据。端口依次为 61262/61419/61558/61895；各组结束只余 `postgres/template0/template1`，`pg_ctl stop=0`、`status=3`、无 postmaster PID。首次沙箱预备在 loopback bind 被拒、未启数据库；四组真实运行经执行权限机制完成。未读 `.env`，未复用任何旧数据库/keepdb，未动默认 Vite 缓存；四组源文件及默认缓存运行前后哈希一致，首轮证据清单 140 项哈希全部复核一致。

建议最小修复为在 Vite 开发配置显式设置 `optimizeDeps.include: ['@noble/hashes/sha2.js', 'fft.js']`，再以全新冷缓存验收；本次只在临时配置验证，**未实施仓库修复**。这是可复现的开发/测试启动配置缺口，也会影响使用 Vite 开发服务的用户；未发现冲突保存逻辑缺陷，本次未做生产构建运行验证。未增加 sleep、放宽断言、屏蔽错误、自动重试或提交代码；未重跑完整 33 场景，首轮仍为 32 通过、1 失败。

### 2026-11-22 Worker 依赖预构建修复验收

已在 `frontend/vite.config.ts` 加入 `optimizeDeps.include: ['@noble/hashes/sha2.js', 'fft.js']`，使选片校验及音频分析的 Worker 依赖在交互前预构建；注释说明迟发现依赖会触发开发页面重载。仅改开发构建配置，无业务模块、接口或依赖方向变化。上面的 32/33 首轮和四组诊断记录保留原样，以下为修复后的独立运行。

验收编排为 `/private/tmp/cuerelay-worker-fix-20261122/run-regression.py`，实际执行：

```sh
.venv/bin/python /private/tmp/cuerelay-worker-fix-20261122/run-regression.py --suite single
.venv/bin/python /private/tmp/cuerelay-worker-fix-20261122/run-regression.py --suite full
```

两次均加载修改后的仓库 Vite 配置，临时启动器**不覆盖 optimizeDeps/include**；仅设置 `envFile: false`、独立 `cacheDir`、原端口及被动观察，保留完整 trace。每次编排创建新的临时目录，且完整回归的每个场景另用一个启动前不存在的缓存目录，不能受益于前例热缓存。原场景、夹具、断言、页面错误检查和超时均未改，保持单 worker、`retries: 0`、不接管已有服务。复建时可按上一节诊断方法搭建临时启动器，但应移除 include 覆盖，让仓库配置成为其唯一来源，并逐场核对 `cold-cache/listening/hot-send` 记录。

| 修复后独立运行 | 通过 | 失败 | 错误 | 跳过 | Django 报告耗时 |
| --- | --- | --- | --- | --- | --- |
| 冷缓存原冲突保护场景 | 1 | 0 | 0 | 0 | 7.657s |
| 冷缓存完整回归 | 33 | 0 | 0 | 0 | 237.997s |

两次 Django 命令退出码均为 0，分别耗时 8.355s/238.753s。完整运行前的入口检查通过（9.726s），实际 33 个 Django 入口与预期场景逐项一致，各报告一次 `Running 1 test using 1 worker` 和 `1 passed`，无重试/跳过。两轮全部 34 次冷启动均无运行中新增依赖或优化器 `full-reload`；两次冲突场景均记录真实 document PUT 的 200、409、409，并完整通过正文/非法时间草稿保留、备份导出、取消及明确重载检查。

`npm run typecheck`、`npm run i18n:check` 均通过；构建通过 Vite 公开 `build({envFile: false})` API 加载原配置执行（`node /private/tmp/cuerelay-worker-fix-20261122/build.mjs`，2.624s），包含原许可材料和手册插件，避免普通 CLI 自动读取 `.env`。构建保留既有大 chunk 提示，未改拆包策略。`git diff --check` 通过；没有新增模块导入或循环依赖，未修改架构文档、测试断言、权限/保存逻辑，未增加固定 sleep、屏蔽错误、启用 Actions 或提交代码。

单场景证据：[运行目录](/private/tmp/cuerelay-worker-fix-single-2b9agqm6/run-summary.md)。完整回归证据：[逐项汇总](/private/tmp/cuerelay-worker-fix-full-5obtuoyh/run-summary.md)、[CSV](/private/tmp/cuerelay-worker-fix-full-5obtuoyh/scenario-results.csv)、[Django 日志](/private/tmp/cuerelay-worker-fix-full-5obtuoyh/django.log)；各场景的 Playwright 日志、trace 及 Vite 事件在对应 `scenarios/` 下，配置快照、元数据和哈希清单在运行目录内。[合并验证结果](/private/tmp/cuerelay-worker-fix-20261122/verification-summary.json)和静态检查/构建日志位于同目录。

两轮分别新建一次性 PostgreSQL 集群，仅监听 loopback 63918/64104，由 Django 创建并销毁独有测试库；未读 `.env`、未使用 keepdb、未接触开发/生产库。结束后均仅余 `postgres/template0/template1`，`pg_ctl stop=0`、`status=3`、无 postmaster PID。运行前后源文件和默认 Vite 缓存哈希一致，原首轮证据 140 项哈希复核一致；本任务只新增上述配置及本节文档，所有先前未提交修改均保留。

可只运行一个场景，彼此没有顺序依赖：

```sh
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_save_refresh_history --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_conflict_preserves_local_edits --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_project_styles_refresh_and_retry --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_workspace_saves_after_style_changes --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_workspace_protects_deleted_history_styles --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_organization_glossary_fork_stays_isolated --settings=application.test_settings --noinput -v 2
```

无需预先启动 Django/Vite，不要直接运行此目录的 Playwright 命令。Django LiveServerTestCase 管理随机端口后端，Playwright Test 自动启动 loopback `5199` 的 Vite，并代理到本次后端；端口已占用会失败，不接管现有服务。浏览器使用仓库 Playwright 版本对应的 Chromium，不依赖系统 Chrome。

每次 Django 命令创建独有 `test_cuerelay_<pid>` 数据库并销毁；每个 E2E 场景清空数据库后重新创建固定 `regression-organizer` / `regression-member`、组织和项目。用户 ID/项目 ID 不写死。密码仅为测试夹具。各场景分别启动全新的浏览器上下文；冲突例在同会话的两个独立页面工作区模拟旧版本。不要使用 `--keepdb` 保留测试业务数据；异常强制终止留下的测试库随 `docker compose down` 一并丢弃。

8 秒黑色视频/440Hz 正弦音通过 FFmpeg 在系统临时目录生成，用真实 SHA-256/字节数作为项目基准；测试结束删除，没有实际片源。ASS 复用仓库自创 `basic.ass` 并在测试中限定为一个普通文本事件；语义与独立引擎回归继续使用已有兼容性语料及手写期望。测试不 Mock 认证、HTTP、项目写入、冲突或 ASS 逻辑，没有固定 sleep、自动重试或大规模快照。

失败时保留 `frontend/test-results/<scenario>/` 内截图、错误上下文和 Playwright trace：

```sh
cd frontend
npx playwright show-trace test-results/<scenario>/<test-directory>/trace.zip
```

结束后停止专用测试库（不影响开发库）：

```sh
docker compose -f compose.test.yml down
```

## 覆盖索引

SRT 格式/HTTP/持久化回归为 `srt_format.tests`、`http_api.test_srt`、`projects.test_srt`，精度、编码、标签和损失契约见 `backend/srt_format/README.md`。真实 Chromium 流程通过以下隔离数据库命令运行，不写开发数据库：

```sh
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_srt_local browser_tests.regression.WorkspaceRegressionTests.test_srt_project browser_tests.regression.WorkspaceRegressionTests.test_srt_english_narrow --settings=application.test_settings --noinput -v 2
```

覆盖失败导入保留历史/多选/原始时间及本机恢复、成功替换新基线、SRT/ASS 文件名和内容、ASS 备份不受格式选择影响、项目初始化/显式保存/重载、英文 360px/键盘/IME/真实清 Cookie 后无会话导出。成功截图写入 `frontend/test-results/srt-*/`，不自动批准快照。新增语言 JSON 后若 Vitest 的磁盘转换缓存未发现文件，可先 `cd frontend && node node_modules/vitest/vitest.mjs --clearCache`，再正常运行；检查全新资源时也可用 `npm run test -- --run --no-fsModuleCache`。本次实际结果见 [SRT 实施记录](plans/srt.md)。

| 风险 | 复用 / 新增测试 | 断言层次 |
| --- | --- | --- |
| 组织默认术语与项目fork | projects.test_glossary / test_glossary_migration、regression/workspace.spec.mjs 的 organization glossary fork stays isolated | 组织唯一默认、默认只读、完整快照/新ID、双向隔离、迁移保留、字幕revision不变 |
| ASS 语义和保留字段 | `ass_format/test_compatibility.py`、`test_follow_up.py`、`http_api/test_ass_compatibility.py`、`projects/test_ass_compatibility.py`、`test:ass-compatibility` | 手写期望、HTTP/DB 往返、独立 libass 字形及模型样式身份 |
| 字幕创建、拆分、撤销/重做 | 既有 `commit-timing.test.ts`、`edit-history.test.ts`、`line-edits.test.ts`、`ass_format/test_splitting.py`、`projects/test_splitting.py`；新增 `regression/workspace.spec.mjs` 第一例 | 纯转换和真实浏览器→HTTP→DB；原子步骤、选行、UUID、最新 revision |
| 字幕批量时间平移 | `subtitle-model/time-shift.test.ts`、`regression/time-shift.spec.mjs`（`WorkspaceRegressionTests.test_workspace_time_shift_project` / `test_workspace_time_shift_local`） | 选中/全文、原子校验、零时长、重排选择、撤销/重做、未应用时间草稿、QC/预览、显式保存和本机恢复；中文项目及英文窄屏键盘/IME |
| 字幕行合并 | `subtitle-model/cue-merge.test.ts`、`regression/cue-merge.spec.mjs`（`WorkspaceRegressionTests.test_workspace_merge_project` / `test_workspace_merge_local`） | 非连续多选、ASS 事件顺序、时间与原元数据、长度拒绝、草稿保护、撤销/重做、只读门禁、隐藏取消、搜索/QC/预览、ASS 往返和显式 revision 保存 |
| 保存后刷新恢复 | 既有 `projects/test_ass_compatibility.py`；新增第一例 | 整文档持久化、刷新读取、刷新后建立新撤销历史 |
| 组织列表和退出落点 | `regression/workspace-drafts.spec.mjs`、`test:context-refresh` / `test:resource-response-races`（HTTP 夹具）、`request-state/read-order.test.ts`、`account-ui/api.test.ts` | 组织/项目持续重叠读取、503 不遮蔽成功撤权、首页/显式组织本地草稿范围与恢复、设置失败时工作区可用、退出后落点与重试、账号切换不等待设置清理旧草稿、迟到认证失败静默、轮询/重返/重载的旧状态不解除较新只读、列表请求收尾与保守分页校正 |
| 本机草稿 | `workspace-drafts/autosave.test.ts`、`regression/workspace-drafts.spec.mjs` | 本地/项目刷新恢复、未选行时间和空项目出点基准、QC 与诊断状态、真实 IndexedDB 事务、revision 冲突及并发导出、跨标签页失效、账号隔离、退出组织后的权限与清理失败 |
| revision 冲突/本地保护 | 既有 `projects/tests.py` 并发保存/归档；新增第二例 | 真实 409、服务器快照未被覆盖、正文/非法时间草稿保留、备份下载、取消/明确放弃、重载新基线 |
| 项目与组织权限 | `projects/tests.py`、`projects/test_styles.py`、`http_api/test_identity.py`、`organizations/tests.py` | member/organizer/dev、跨组织、撤权、停用、CSRF、并发最后 organizer |
| 项目样式/ASS 导出 | `ass_format/test_styles.py`、`projects/test_styles.py`、兼容性语料/独立引擎 | 样式 UUID/引用/颜色/字体/字号、模板独立快照、失败整批回滚、样式 revision |
| 样式与字幕保存竞争 | `project-style-save.test.ts`、`project-document-save.test.ts`、`history-styles.test.ts`；regression/workspace.spec.mjs 的 project styles refresh and retry / workspace saves after style changes / workspace protects history styles deleted remotely | 设置页刷新/重试，工作台合并仅样式变化并保留字幕/新增行/原始草稿/视频/历史，撤销重做后继续保存、真实字幕竞争保护、删除历史所需样式时不重试 |

较全面的旧浏览器脚本继续保留于 `frontend/browser-tests/`，入口与环境见该目录 README。它们没有全部接入本轮 CI；不要把 fixture 驱动的 HTTP 当成真实数据库 E2E，也不要把历史手动实验记录当成本次执行结果。

## CI 与边界

2026-11-11：按用户要求暂缓 GitHub Actions，当前只运行本地测试。`.github/workflows/regression.yml` 保留为本地草案，并由根目录 `.gitignore` 忽略，尚未纳入 Git，不会随普通提交上传。恢复时需先移除该忽略规则，再检查并提交 workflow。

草案计划在 push / pull_request / 手动触发时运行上述检查：独立 PostgreSQL 16 service、固定测试凭据、FFmpeg/Nginx/Chromium 安装，不引用生产 secrets，不部署。失败立即返回非零，不用 continue-on-error 或重试；浏览器失败证据保留 7 天。远端执行仍未验证。

实现使用 Django 官方 [LiveServerTestCase](https://docs.djangoproject.com/en/5.2/topics/testing/tools/#liveservertestcase)、Playwright 的 [webServer](https://playwright.dev/docs/test-webserver) 与 GitHub 的 [PostgreSQL service](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) 机制。产品依赖方向和公开接口没有改变。

本轮不覆盖 Firefox/Safari、真实片源/多声道长媒体、浏览器撤权全链路、完整网络故障矩阵或未来实时协作。后续优先加入撤权后的备份、提交成功但响应丢失，再按风险整理旧浏览器脚本；不用扩大 E2E 数量替代轻量规则测试。

## 术语表

`projects.test_glossary` / `projects.test_glossary_migration` 纳入上述 projects 全量测试；覆盖组织默认首次创建事务、并发fork/组织修改、默认共享/副本双向隔离、权限/归档/跨组织、独立 CAS、重复/长度/字面搜索及字幕 revision 不变、旧项目迁移后保存。前端 Vitest 包括 glossary-data/rules 与 workspace-ui/term-insertion。

`cd frontend && npm run test:glossary`：需先在另一个终端 `npm run dev -- --port 5227 --strictPort`，GLOSSARY_URL 可改地址。真实 Chrome + FFmpeg 合成视频 + Python codec，HTTP 使用隔离 fixture，不写开发库；覆盖组织维护/默认只读/fork/双向隔离、表单失败/冲突/IME、归档、宽窄侧栏、光标/选区/撤销、无字幕保存/播放器重建，以及真实 App 项目/账号切换和撤权后旧响应隔离。新增真实数据库浏览器E2E见 `WorkspaceRegressionTests.test_organization_glossary_fork_stays_isolated`（组织设置创建、项目fork、编辑复制词条/新增词条、双向隔离、保存revision不变和刷新持久化）；`manage.py test browser_tests.regression` 一并运行。见 [最新术语验证](experiments/organization-glossary.md)。

## 中英文与布局

国际化资源检查、语义复数、占位符、类型生成、三语言 Playwright 布局/截图及工作区状态保护的命令与验收边界见 [国际化维护手册](internationalization.md#local-commands)。既有独立浏览器脚本和真实 E2E 明确使用 zh-CN；`WorkspaceRegressionTests.test_english_language_preserves_editor_state` 覆盖英文切换、真实设置持久化及保存/刷新。首次截图仅作待审证据，不自动成为正确基线。CI 决策不变。
