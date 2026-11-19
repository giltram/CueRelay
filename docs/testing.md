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
.venv/bin/python backend/manage.py test accounts ass_format http_api organizations projects diagnostics --settings=application.test_settings --noinput -v 2
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
