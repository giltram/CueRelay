# 自动化回归测试

从仓库根目录运行本页命令。测试不需要 `.env`、生产密钥、开发账号或开发数据库。环境要求同根目录 README：Python 3.11、Node 26、npm、FFmpeg；数据库可用 Docker Compose 启动专用 PostgreSQL 16。真实代理回归另需 Nginx。

按已实现功能区分真库 E2E、浏览器 fixture、单元/集成与人工边界的索引见 [测试覆盖矩阵](testing-coverage.md)。统一回归现有 57 场景（含组织member权限新增3场）；本轮记录见文末，历史 33/35 场景的首轮失败、诊断与修复验收保留原记录。

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

## 数据保护回归（2026-11-22）

新增 `frontend/regression/data-protection.spec.mjs` 两例，既有 33 场景的代码和行为不变，各新增 Django 入口准确选择一个场景：

```sh
.venv/bin/python backend/manage.py test \
  browser_tests.regression.WorkspaceRegressionTests.test_revocation_preserves_local_edits \
  browser_tests.regression.WorkspaceRegressionTests.test_lost_save_response_preserves_draft \
  --settings=application.test_settings --noinput -v 2
```

- 撤权：member 已验证片源、修改正文及非法时间后，独立 organizer 会话通过真实成员 DELETE 撤权；focus 触发真实项目 GET 403。原编辑节点、正文、原始时间及完整 IndexedDB 副本保持，编辑/保存/快捷键写入受保护，仍可在现有重载保护弹窗下载完整 ASS 并取消。浏览器无项目 mutation，独立 organizer HTTP 和 Django ORM 确认项目快照/revision/更新时间未变、成员关系已删除。
- 丢响应：route.fetch 真提交 PUT 后核对 200/revision2及独立 HTTP 快照，再 route.abort；前端显示结果未知，保留 revision1 的原副本和非法时间，无自动重试。之后新增的本机正文用旧 revision 手动保存得到真实409，仍可完整备份/取消；明确重载接纳已提交版本后使用 revision2 保存成功到3，最终 HTTP/ORM 快照一致。所有 PUT 精确为 revision `[1,1,2]`，没有新增恢复 UI 或重试机制。
- ASS 备份只含已应用文档；非法时间继续保留于输入和本机草稿，保护弹窗沿用“保存和导出都不会包含它们”的说明。下载比较完整文件，包括原脚本/样式/事件元数据及手写 Dialogue 期望。

定向验证已通过 2/2（Django `Ran 2 tests in 15.173s`，命令墙钟15.842秒），两例各自独立冷缓存、真实 Chromium，0失败/错误/跳过/重试；证据 `/private/tmp/cuerelay-data-protection-targeted-k3fbc9cq/`，编排 `/private/tmp/cuerelay-data-protection-run-20261122.py --suite targeted`。loopback PostgreSQL 端口57059，Django 创建并销毁独有测试库；结束仅余 postgres/template0/template1，stop=0/status=3/无PID。沙箱预备尝试 `/private/tmp/cuerelay-data-protection-targeted-9_wb6219` 在绑定端口时被拒绝，未启动集群或Django，不计入场景结果。

**新增两例后的完整独立验收：35/35通过。** 实际编排命令为：

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python /private/tmp/cuerelay-data-protection-run-20261122.py --suite full
```

该编排调用 Django 完整 `browser_tests.regression --settings=application.test_settings --noinput -v 2`，仅通过临时启动配置分离冷缓存、日志与trace输出；原场景、夹具、断言、`retries: 0` 和仓库 optimizeDeps 不变。Vite 公开 createServer/build 使用 `envFile: false`，不读取 `.env`。

| 本次结果 | 通过 | 失败 | 错误 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| Playwright 场景 | 35 | 0 | 0 | 0 |
| Django 入口（含最终 ORM 断言） | 35 | 0 | 0 | 0 |

Django 实际为 `Ran 35 tests in 245.582s / OK`，命令墙钟246.259秒，退出码0。35个入口和预期场景逐项一致，每例仅一次 `Running 1 test using 1 worker / 1 passed`，无自动重试；35份全新Vite缓存均在首次启动前不存在，使用仓库include且没有full-reload。两例新增场景在本轮再次通过。代码文件运行前后及当前SHA-256一致，默认Vite缓存哈希未变；运行中仅更正文档对定向Django/墙钟耗时的区分，未改代码。此前33场景历史记录不作为本轮替代证据。

完整证据 `/private/tmp/cuerelay-data-protection-full-wxx0fhoa/` 包含 [逐项CSV](/private/tmp/cuerelay-data-protection-full-wxx0fhoa/scenario-results.csv)、[汇总](/private/tmp/cuerelay-data-protection-full-wxx0fhoa/verified-summary.json)、[完整日志](/private/tmp/cuerelay-data-protection-full-wxx0fhoa/django.log)、`metadata.json`、`selection.log`、每场景的Playwright日志/trace/Vite事件及 `artifact-sha256.json`（172项）。前置选择检查通过：35入口/35场景一一对应，Django unittest 9.385秒（命令墙钟9.450秒）。全新PostgreSQL只监听loopback59136，Django创建并销毁 `test_cuerelay_46617`；清理后仅余postgres/template0/template1，pg_ctl stop=0/status=3/无postmaster PID。不使用keepdb、不访问开发/生产库、不启用Actions。

轻量及静态检查证据在 `/private/tmp/cuerelay-data-protection-checks-20261122/`：

- 相关Vitest四文件36/36通过（140ms）：`project-document-save`、`workspace-drafts/autosave`、`workspace-changes`、`diagnostics/http`。通过 `unit.mjs` 的公开 startVitest API 禁用env文件读取；没有新增镜像实现的单测。
- `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover -s scripts -p 'test_*.py' -v`：6/6通过，10.058秒，包括实际Playwright发现检查。
- `npm --prefix frontend run typecheck`、`npm --prefix frontend run i18n:check`、新增JS语法、Python内存compile及 `git diff --check` 均通过。Vite公开build API加载原配置构建通过（2.42秒），保留原许可与手册插件，日志仍有既有大chunk提示以及envFile参数弃用提示。
- 无产品代码修改，无新增业务模块导入或依赖方向；只新增隔离测试文件/入口和文档。独立只读代码、矩阵及完整证据最终复核均通过，无必须修复问题，报告 `/private/tmp/cuerelay-data-protection-review-20261122.md`；已核对35份冷缓存运行、代码哈希、172项归档证据哈希、静态/构建日志和数据库清理，本次提交归档。

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

本轮不覆盖 Firefox/Safari、真实片源/多声道长媒体、完整网络故障矩阵或未来实时协作。新增两例已覆盖编辑中成员删除及 document PUT 提交后丢响应；拆分/样式等其他写入丢响应仍主要由下层测试保护。其余缺口见覆盖矩阵，按风险整理旧浏览器脚本，不用扩大 E2E 数量替代轻量规则测试。

## 术语表

`projects.test_glossary` / `projects.test_glossary_migration` 纳入上述 projects 全量测试；覆盖组织默认首次创建事务、并发fork/组织修改、默认共享/副本双向隔离、权限/归档/跨组织、独立 CAS、重复/长度/字面搜索及字幕 revision 不变、旧项目迁移后保存。前端 Vitest 包括 glossary-data/rules 与 workspace-ui/term-insertion。

`cd frontend && npm run test:glossary`：需先在另一个终端 `npm run dev -- --port 5227 --strictPort`，GLOSSARY_URL 可改地址。真实 Chrome + FFmpeg 合成视频 + Python codec，HTTP 使用隔离 fixture，不写开发库；覆盖组织维护/默认只读/fork/双向隔离、表单失败/冲突/IME、归档、宽窄侧栏、光标/选区/撤销、无字幕保存/播放器重建，以及真实 App 项目/账号切换和撤权后旧响应隔离。新增真实数据库浏览器E2E见 `WorkspaceRegressionTests.test_organization_glossary_fork_stays_isolated`（组织设置创建、项目fork、编辑复制词条/新增词条、双向隔离、保存revision不变和刷新持久化）；`manage.py test browser_tests.regression` 一并运行。见 [最新术语验证](experiments/organization-glossary.md)。

## 中英文与布局

国际化资源检查、语义复数、占位符、类型生成、三语言 Playwright 布局/截图及工作区状态保护的命令与验收边界见 [国际化维护手册](internationalization.md#local-commands)。既有独立浏览器脚本和真实 E2E 明确使用 zh-CN；`WorkspaceRegressionTests.test_english_language_preserves_editor_state` 覆盖英文切换、真实设置持久化及保存/刷新。首次截图仅作待审证据，不自动成为正确基线。CI 决策不变。

## 账号、项目与编辑样式回归（2026-11-22）

本轮先核对35个实际入口及公开契约，再新增10条场景；[执行计划](plans/e2e-account-project-editing-2026-11-22.md) 记录已有覆盖、补齐范围与验收断言。新场景按账号设置、项目管理、编辑操作、样式拆成四个spec，helpers只共享浏览器操作/真实HTTP断言；Django入口继续显式一一对应，并核对最终ORM。既有35条场景及产品代码未改，无新功能、依赖或公共契约变化。

- 账号与设置：真实登录失败/成功/刷新/退出、改密失败保留/成功清空、旧会话与旧密码失效/新密码可登录；真实5次失败冷却、正确密码仍429、Retry-After与UI秒数一致及输入保留，ORM确认锁定不续期。快捷键、焦点切换、鼠标边界、音频模式保存/刷新/恢复默认/换号隔离；仅两次未送达PATCH的abort故障注入，失败不落库，成功走真实后端。语言复用已有英文场景，未重复新增。
- 项目管理：无字幕/ASS创建及真实400失败保留（SRT复用原场景）、两组织/状态/搜索/跨页准确行与总数、元数据保存刷新→归档只读→恢复后member显式保存，最终revision5。member不能修改元数据/归档；无视频/错误视频不可编辑，正确完整哈希解锁。
- 编辑与样式：实际Chromium剪贴板复制/剪切/粘贴/字段覆盖失败保留→显式保存刷新，保留时间/ID/隐藏ASS字段；空文本播放头拆分真实保存一次、裁剪、插入/删除、非连续多选行样式显式保存刷新。组织模板CRUD/重名失败保留/member403；项目双模板复制导入失败原子性、批量仅改选定字段、复制/分配/重命名/未使用删除/已引用禁止删除，模板修改删除不影响项目副本，刷新/ASS/ORM引用完整。

首轮定向8通过/2失败（Django77.044s，墙钟77.822s），第二轮9通过/1失败（79.179s/79.849s）。新测试分别误用了身份URL、网络错误文案及退出后登录落点；已按仓库公开契约修正，没有发现产品缺陷，也没有放宽业务断言。失败证据完整保留在 `/private/tmp/cuerelay-account-project-editing-targeted-z45zny_4/` 和 `...-b5a6bl11/`，无自动重试。预备沙箱绑定被拒发生在启动服务前，目录 `...-cmjrrv5o/`；真实运行随后经执行权限机制完成。

最终定向10/10通过，Django70.646s、墙钟71.368s；失败/错误/跳过/重试均0，10个入口各选中1例。证据 `/private/tmp/cuerelay-account-project-editing-targeted-iovqe499/` 含django.log、逐项CSV、verified-summary.json、每场trace/Vite事件及72项artifact哈希。每场独立空缓存、无新增依赖/full-reload，运行前后源码与默认Vite缓存哈希一致。

本次使用 `/private/tmp/cuerelay-account-project-editing-run-20261122.py`（各运行目录中归档为orchestrator.py）实际执行 `--suite targeted`、`--suite backend`、`--suite full`。runner仅改变外部进程配置/证据路径，保留原入口/夹具/断言/超时/retries:0；公开Vite createServer加载仓库配置，envFile:false、每场新的绝对cacheDir，原optimizeDeps完全不覆盖，记录冷启动/listening/hot-send。标准统一入口仍是本文上方的 `manage.py test browser_tests.regression`。

完整统一套件45/45通过（既有35 + 新增10），Django319.782s、命令墙钟320.594s；Playwright和Django失败/错误/跳过/重试均0。运行前单独的45入口选择检查通过（12.946s）；逐项核对每个Django入口只运行一个预期场景。全新loopback61260集群创建并销毁test_cuerelay_71243，45次Vite启动各使用启动前不存在的缓存，无运行中新增依赖/full-reload，源码及默认Vite缓存运行前后哈希一致。证据 [verified-summary.json](/private/tmp/cuerelay-account-project-editing-full-l10laaqj/verified-summary.json)、[逐项CSV](/private/tmp/cuerelay-account-project-editing-full-l10laaqj/scenario-results.csv)、[django.log](/private/tmp/cuerelay-account-project-editing-full-l10laaqj/django.log)；同目录含完整trace、Vite事件、配置/源码快照、清理元数据及217项artifact哈希。全部为本轮新运行，未借用旧35/35记录。

相关后端145/145通过，Django15.790s（墙钟16.440s），错误/失败/跳过0；包括 accounts、http_api.test_identity/test_i18n/test_clipboard、organizations、projects、ass_format.test_clipboard/test_splitting/test_styles，独立集群证据 `/private/tmp/cuerelay-account-project-editing-backend-nti3_cr5/`。前端10文件132/132（263ms）、scripts6/6（13.308s，含45入口选择）、typecheck、i18n:check、全部regression JS/Python语法、diff检查及Vite生产构建（2.644s，保留既有chunk提示）通过，证据 `/private/tmp/cuerelay-account-project-editing-checks-20261122/`。Vitest通过公开startVitest传入envFile:false及独立cacheDir，构建使用build({envFile:false})；未跳过许可/手册插件。

所有数据库运行均另建本机一次性PostgreSQL集群，未读取.env、未使用keepdb或开发/生产数据库；Django销毁测试库后清单仅postgres/template0/template1，自建集群stop=0、status=3且无postmaster.pid。最终只读复核确认旧方法AST/旧spec字节一致、重要写入含服务器刷新/revision和ORM断言、无成功业务替身/固定sleep/skip/新增测试重试；产品依赖未改，新测试依赖spec→helpers→Playwright无环。复核证据见checks目录review文件。不提交、不推送，Actions继续暂停。

人工边界：context授权的浏览器剪贴板不代表外部应用/OS权限；setInputFiles不代表系统picker取消/持久文件句柄授权；合成MP4不代表真实片源/多声道长媒体、设备听感、字体观感或跨浏览器。冷却到期/滑动窗口/并发留在后端验证，UI无倒计时禁用契约；模板scale/脚本及完整字段/快捷键组合继续由既有下层/fixture保护，不声明全部组合覆盖。其他网络丢响应写入、系统权限与真实制作验收见覆盖矩阵。

### 2026-11-22 辅助入口、媒体平台与故障场景

本轮计划和有限故障矩阵见 [执行计划](plans/e2e-aux-media-failures-2026-11-22.md)。在此前45场景基础上新增7条：首次手册本人确认/账号隔离、真实密码错误→个人设置诊断JSON→隔离后端日志关联、split/styles服务端已提交丢响应、断网/传输超时/503、真实session失效与成员撤权后的恢复。成功写入均经真实HTTP/PostgreSQL；丢响应先route.fetch确认200并独立GET，再abort，仅失败可fulfill。未知结果不接纳新基准、不自动重放，正文/时间/选择/IndexedDB或样式表单保持；明确重载/重新打开/登录/重新授权后继续显式保存，最终ORM核实。

可重复的隔离运行入口（`--pg-bin` 指向本机安装的PostgreSQL bin，不指向数据目录）：

```sh
.venv/bin/python scripts/run_isolated_regression.py --suite targeted --pg-bin /absolute/postgres/bin
.venv/bin/python scripts/run_isolated_regression.py --suite backend --pg-bin /absolute/postgres/bin
.venv/bin/python -m unittest scripts.test_regression_selection -v
.venv/bin/python scripts/run_isolated_regression.py --suite full --pg-bin /absolute/postgres/bin
.venv/bin/python scripts/run_isolated_regression.py --suite media --production-app --pg-bin /absolute/postgres/bin
.venv/bin/python scripts/run_isolated_regression.py --suite specialists --pg-bin /absolute/postgres/bin
node frontend/node_modules/playwright/cli.js install firefox webkit
.venv/bin/python scripts/run_isolated_regression.py --suite platform --browser firefox --pg-bin /absolute/postgres/bin
.venv/bin/python scripts/run_isolated_regression.py --suite platform --browser webkit --pg-bin /absolute/postgres/bin
.venv/bin/python scripts/run_isolated_regression.py --suite production --pg-bin /absolute/postgres/bin
```

每次另建loopback临时集群并由Django创建/销毁测试库；浏览器服务5199专供该次串行验收、strictPort且拒绝接管已有服务，PostgreSQL端口动态分配。证据写新建 `/private/tmp/cuerelay-aux-media-failures-*`，含源码快照、逐场空Vite缓存、JSON/list报告、全部trace与清理元数据；不加载.env/普通PG配置、不keepdb、不覆盖先前失败。统一入口仍只运行Chromium；独立platform/media/production/specialists不计入统一52条。生产专项需先用Vite公开build({envFile:false})构建；原手册/许可插件不能关闭。

media规格：180秒黑色H264视频320×180/10fps，AAC 48kHz/5.1六声道各固定正弦、384kbps；ffprobe核对实际规格，文件上限16MiB，生成超时60秒、场景超时180秒。完整哈希、真实分析Worker、150.5→5→175→150.5秒seek、32MiB分析缓存、JASSUB实际字幕画面变化/开关恢复、150–155秒独立试听多窗PCM（每消息≤4MiB）、隐藏/恢复/卸载清理全部在正式项目页执行；视频/音频字节不上传；字幕快照仅走既有codec。Object URL revoke、Worker terminate、AudioContext close与排程/PCM计数不是设备听感、原生内存释放或无泄漏证明，也不是任意媒体/真实长片覆盖。

specialists复用video-restore、audio-timeline、audio-audition三个维护中的脚本，单独记录各脚本退出与日志，不把内部检查点当统一场景计数。前两者用隔离身份/项目fixture或专用真库登录；音频/预览计算仍真实。wrapper显式传入一次性账号和`BROWSER_TEST_CHANNEL=bundled`使用配套Chromium；三个脚本原默认仍为系统Chrome。OPFS句柄、IndexedDB和哈希真实；OS picker/权限决定仍是fixture。

macOS14冻结WebKit与仓库Playwright1.62.1可能在建页时出现`PushAPIEnabled`协议错误；不可把此失败记为应用通过。可在新临时目录安装独立Playwright1.60.0，通过以下显式兼容评估入口运行**同一应用流程函数/断言**，不修改仓库依赖或驱动、不移除COEP：

```sh
npm install --prefix /private/tmp/cuerelay-webkit-driver playwright@1.60.0 --ignore-scripts --no-audit --no-fund
.venv/bin/python scripts/run_isolated_regression.py --suite platform --browser webkit --production-app \
  --webkit-driver /private/tmp/cuerelay-webkit-driver/node_modules/playwright --pg-bin /absolute/postgres/bin
```

1.60的mac14-arm64清单同样指定冻结revision2251，初始化不发送该新增设置，依据[上游浏览器清单](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/browsers.json)和[驱动源码](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/webkit/wkPage.ts)。单独记录开发模式COEP/Worker结果、生产结果和驱动版本；WebKit结果不等于真实Safari验收，不扩大既有“Firefox/Safari评估后决定支持范围”的产品契约。

本轮最终执行统计如下；上面的历史45/45不计本轮结果。

#### 本轮最终实测结果

以下均为本轮新执行；失败、错误、跳过及自动测试重试在这些最终成功运行中均为0。先前失败尝试另记，未借用历史45/45。环境：macOS14.8.5 arm64、Python3.11.8、Node26.4.0、PostgreSQL16.2、FFmpeg9.0.2、仓库Playwright1.62.1；Chromium151.0.7922.34、Firefox153.0，冻结WebKit26.4另用隔离Playwright1.60.0驱动。

| 实际运行 | 通过 / 实际执行 | Django耗时 / 命令墙钟 | 证据目录（均在 `/private/tmp/`） |
| --- | ---: | --- | --- |
| 最终新增定向 | 7/7 | 46.496s / 47.100s | `cuerelay-aux-media-failures-targeted-chromium-u7rt59cd` |
| 完整统一Chromium | **52/52** | **376.299s / 377.076s** | `cuerelay-aux-media-failures-full-chromium-wk6yxrud` |
| 受影响后端 | 131/131 | 16.672s / 17.327s | `cuerelay-aux-media-failures-backend-chromium-55j4mtxx` |
| 生产180秒/5.1合成媒体 | 1/1 | 15.559s / 16.169s | `cuerelay-aux-media-failures-media-chromium-m4ex86bo` |
| 既有专项合跑 | **3/3脚本**（1个wrapper，不计入52） | 69.366s / 69.949s | `cuerelay-aux-media-failures-specialists-chromium-ovbg5c78` |
| Firefox代表应用流程 | 1/1 | 10.516s / 11.188s | `cuerelay-aux-media-failures-platform-firefox-5i0vno4k` |
| WebKit生产代表流程，隔离兼容驱动 | 1/1 | 4.141s / 4.834s | `cuerelay-aux-media-failures-platform-webkit-mjgic8j0` |
| 生产手册/许可/源码下载 | 1/1 | 2.379s / 3.001s | `cuerelay-aux-media-failures-production-chromium-sptckr6q` |

完整52项逐个准确运行一例，每场空Vite缓存，未发现运行中新增依赖或full-reload；运行前后源码及默认Vite缓存哈希相同。[完整核验摘要](/private/tmp/cuerelay-aux-media-failures-full-chromium-wk6yxrud/verified-summary.json)、[逐项CSV](/private/tmp/cuerelay-aux-media-failures-full-chromium-wk6yxrud/scenario-results.csv)、[Django日志](/private/tmp/cuerelay-aux-media-failures-full-chromium-wk6yxrud/django.log)与同目录52份Playwright JSON/list/trace、Vite事件、源码快照及清理元数据相互对应。每个数据库运行均销毁测试库，仅剩postgres/template0/template1，stop=0/status=3/无postmaster.pid；所有自建服务均已收尾。

前端27文件223/223（718ms）、scripts6/6（最终19.062s，含52入口选择）、typecheck、i18n:check、Python/JS语法、diff检查及envFile:false生产构建（2.60s，保留既有chunk提示）均实际通过。检查证据在 `/private/tmp/cuerelay-aux-media-failures-checks-20261122/`。最终只读复核确认原45个测试方法AST、原setUp/setUpClass（已移入共享fixture）、上一聊天4个spec及helpers字节均保留；产品源码、公开接口和模块依赖未变，没有新增固定sleep、skip或测试自动重试。此前45场景的217项历史artifact哈希亦复核一致，仅作为保留证据，不计本轮通过。

生产媒体实测：180.000秒、8,739,168字节、H264320×180、AAC48kHz/6声道5.1；五秒试听实际3条PCM消息，最大2,304,000字节、236次节点排程。卸载观察到5/5 Worker terminate、1/1 AudioContext close完成、1/1 Object URL revoke；这些是有限生命周期/调用证据，不代表原生内存审计或设备听感。媒体字节不上传，字幕快照仍仅走既有codec。最终专项各自实耗8.830s（video-restore）、16.575s（audio-timeline）、39.855s（audio-audition），各有独立日志/原脚本临时artifact路径。可用 `--suite specialists --specialist audio-timeline` 显式只运行一个命名脚本，结果按实际1个脚本计，不是skip。

两浏览器代表流均真实登录、导入并播放合成视频、音频分析Worker ready、显式保存→刷新持久化、个人设置打开手册；实际capability记录均为AAC/Web Locks可用、showOpenFilePicker不可用，输入文件回退流程可用。未覆盖两浏览器的完整52套件或全部JASSUB/试听组合。当前仓库1.62.1+mac14冻结WebKit的默认建页仍阻塞，隔离兼容驱动的开发流也有COEP Worker加载失败；生产bundle的同一流程/断言通过。没有修改驱动源码、安全头或产品支持范围，WebKit不等于实际Safari。

#### 失败历史与手工边界

定向首两轮各5/6（诊断测试旧role选择器、登录导航等待错误），修正后6/6，追加真实撤权恢复后7/7；完整52/52是其后的新运行。WebKit前两次未通过分别是默认驱动建页协议错误与开发COEP Worker错误，分别保存在 `...-platform-webkit-0q6q3qo1`、`...-platform-webkit-jyf6meb8`，没有写作应用通过。

旧专项最初缺少专用登录配置，随后暴露旧错误类选择器、样式名已变成稳定ID、保留的平移视窗、即时读取上一帧DOM、显式选行会定位视频、时间戳下载名，以及新标签页/未保存稿离页保护等测试契约问题。修正交互准备/选择器和精确状态等待，保留时间/几何/正文/清理断言，并加强实际ASS下载内容检查；未修补产品以迁就测试。六次三脚本失败合跑、三次时间轴单独失败及最后单独通过、三脚本全通过的原日志、截图均保留，不作自动retry。临时Shift及坐标探针没有进入最终代码。共13次未通过的测试运行（定向2、WebKit2、专项9）及全部成功运行的实际计数/耗时/清理状态在 [逐次执行索引](/private/tmp/cuerelay-aux-media-failures-checks-20261122/run-history.json)，不是用例发现数。最初沙箱bind拒绝未启动服务；一次长Unix socket路径预备失败的数据库也已自行退出，记录在 `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-aux-media-failures-targeted-chromium-ehtsdi_c/`。

自动化实现和上述实际运行已完成。以下**未验收**，不能由52/52或合成媒体结果推定：

- 真实Safari、Windows及其他浏览器/系统版本；mac14当前默认WebKit驱动/开发模式限制仍在，需匹配的新系统/驱动环境再评估。
- OS原生文件选择器的取消、持久授权、重启浏览器后授权、站点撤权、外接盘/文件移除；OPFS句柄fixture不替代原生权限验收。
- 经用户明确提供并允许使用的真实长片/高分辨率/多声道素材、真实设备的扬声器/耳机声道映射、试听听感及最终视觉QC；本轮未读取私人素材。
- 原生/GPU内存释放、长时间压力、真实配额/磁盘耗尽、进程崩溃最后一批数据，以及未列入有限网络矩阵的故障组合。已有media-memory命令保留，未冒用合成片或清理调用次数证明无泄漏。

未提交、未推送，GitHub Actions继续暂停；无新增产品功能、诊断接口或产品支持承诺。

## 常用 ASS 静态标签回归（2026-11-22）

新增 `browser_tests.regression.WorkspaceRegressionTests.test_ass_static_local` / `test_ass_static_project`，对应 `frontend/regression/ass-static.spec.mjs` 两个场景，已通过真实转换/持久化/预览服务检查。`ass_format.test_text`、原兼容语料与 `npm run test:ass-compatibility` 验证颜色/alpha、an/pos、r 的语义和实际 WASM 渲染。结果、命令、首轮失败修正及测试入口既有限制见 [实施记录](plans/ass-static-compatibility.md)。


## 组织member可配置权限（2026-11-22）

本轮新增3个统一浏览器入口，当前57场景；选择检查仍要求逐项一一对应。权限契约/范围见 [组织member权限](member-permissions.md)，实施及实际证据见 [实施记录](plans/member-permissions.md)。

```sh
.venv/bin/python backend/manage.py test organizations.test_permissions organizations.test_permission_migration --settings=application.test_settings --noinput -v 2
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_member_permission_settings browser_tests.regression.WorkspaceRegressionTests.test_member_permission_workspace browser_tests.regression.WorkspaceRegressionTests.test_member_permission_business_controls --settings=application.test_settings --noinput -v 2
npm --prefix frontend run test -- --run --exclude 'platform-tests/**'
```

本轮后端246项运行，245通过、1项Nginx代理测试因本机未安装Nginx而skip；549项前端单元、6项脚本检查、7场定向真实Chromium（含新增3场及原项目生命周期/模板/术语/撤权）、类型/i18n/生产构建及ASS引擎兼容检查通过。未跑全部57场浏览器或手工真片源。

既有默认Vitest配置漏排除`platform-tests/**`，直接`npm run test -- --run`会误收集3个需要Django夹具的Playwright文件；本轮未改无关测试配置，使用上述明确排除命令运行全部单元测试。该问题与权限功能分开记录。

## 项目参考字幕（2026-11-22）

`projects.test_reference` / `projects.test_reference_migration` / `srt_format.test_reference` 验证独立参考CAS、创建原子性、可配置edit_project、组织/身份/CSRF/归档、并发字幕保存和旧项目迁移。`frontend/src/reference-subtitles/matching.test.ts` 验证时间/零段/多匹配/上下文与媒体上下文优先级，文件读取复用subtitle-api.test.ts。

统一Chromium新增显式 `test_reference_settings` / `test_reference_creation` / `test_reference_isolation`（reference-subtitles.spec.mjs），发现选择校验仍一一对应，当前共60场。本轮实际运行的后端222（221通过/1项Nginx跳过）、前端554与6场浏览器、失败历史/证据/迁移复现及人工边界见 [实施记录](plans/project-reference-subtitles.md)。不把发现数写作完整回归通过数。

### 视频下方参考字幕布局实验

已有前端服务运行时执行 `cd frontend && npm run test:reference-layout`；可通过 `REFERENCE_LAYOUT_URL` 指定地址。此项使用真实 Chrome/合成 MP4 与隔离 HTTP 夹具验证桌面、短窗口、窄桌面、窄屏及拖动后的布局；业务行为仍由三条 `WorkspaceRegressionTests.test_reference_*` 真库场景验证。本次结果、截图与旧 compact/resize 测试的基准失败见 [实验记录](plans/reference-below-video.md)。
