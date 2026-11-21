# 端到端回归后续工作

日期：2026-11-22。用户授权无人值守完成既定计划；各工作聊天使用 `gpt-6.1-sol` / `high`。

## 范围与完成条件

1. 独立只读复核当前入口选择、成员断言、Worker 依赖预构建修复及相关文档；解决有证据的缺陷后提交稳定基线。
2. 按已实现功能建立覆盖矩阵，明确真实浏览器/HTTP/PostgreSQL、模拟接口浏览器、单元/集成测试及实际未覆盖范围，不把计划中的协作功能计为已实现功能。
3. 补充编辑中被撤权后的本地稿保留/备份端到端测试。
4. 补充服务器提交成功但响应丢失时的本地保护/后续恢复端到端测试。
5. 运行新增定向场景、入口一一对应检查、受影响静态检查及完整端到端套件；独立审查最终改动并提交。

产品行为以既有公开契约为准；如新测试暴露可复现缺陷，在上述数据保护范围内采用最小修复。不得放宽断言、增加固定等待、自动重试或跳过来制造通过，不启用 Actions、不推送远端、不接触开发/生产数据库。

## 当前状态

- 原首轮 33 场景为 32 通过、1 失败；原因与后续修复记录保留于 `docs/testing.md`。
- Worker 依赖预构建修复后独立冷缓存验收为 33/33 通过；本轮独立复核已通过，无必须修复发现。
- 本轮开始时未提交修改：`backend/browser_tests/regression.py`、`docs/architecture.md`、`docs/testing.md`、`frontend/regression/workspace-drafts.spec.mjs`、`frontend/vite.config.ts`，另有新增 `scripts/test_regression_selection.py`。这些已授权修改均已保留、独立复核并归入稳定基线。
- 阶段 1 独立复核：脚本测试 6/6 通过，入口选择变异验证通过；已核对 1+33 场景冷缓存证据与文件哈希。报告 `/private/tmp/cuerelay-baseline-review-20261122.md`。复核后已提交基线并实施数据保护测试。
- 稳定基线已提交：`657f77c`（`fix e2e selection and cold startup`）。
- 覆盖矩阵已交接：`docs/testing-coverage.md`，已集成两项新增场景及35入口快照，其他实际缺口仍保留。
- 数据保护两例已实现于独立 `frontend/regression/data-protection.spec.mjs`；定向真实 Chromium/PostgreSQL 2/2 通过，未发现产品缺陷，无产品代码变更。入口一一对应35/35、typecheck/i18n通过。
- 相关36项单测、6项脚本、类型/国际化/语法/差异检查及生产构建通过；完整新集群冷缓存35/35通过，详细结果见下。
- 独立代码、矩阵及完整证据最终复核均通过，无必须修复发现，报告 `/private/tmp/cuerelay-data-protection-review-20261122.md`。本计划全部实现、验证与审查已完成，第二阶段由本次提交归档；不推送、不启用 Actions。

## 工作交接

- 基线只读复核：聊天 `01a1ff17-02ab-7f60-a841-1464f676bb82`，报告 `/private/tmp/cuerelay-baseline-review-20261122.md`。
- 覆盖矩阵：聊天 `01a1ff17-0ec4-7021-936e-5612eb902550`，只写 `docs/testing-coverage.md`。
- 数据保护：聊天 `01a1ff17-7b7c-7020-9dd0-a97868326a51`，只读设计已完成于 `/private/tmp/cuerelay-data-protection-plan-20261122.md`，基线复核后已获授权实施。实施期间由此聊天唯一修改测试/产品代码及本计划、`docs/testing.md`，避免并发编辑；第二阶段已通过独立最终审查，由本次提交归档。

## 验证约定

真实浏览器测试使用全新一次性 PostgreSQL 集群及 Django 测试库，遵循 `docs/testing.md`；不加载 `.env`、不使用 `keepdb`。冷缓存实验使用隔离缓存，保留原始日志与失败证据；结束销毁测试库并停止集群。每次执行如实记录通过/失败/错误/跳过及命令、环境和证据位置。

以下为本轮已完成的实施决策、验证与证据，以仓库记录作为归档和后续维护依据。

## 数据保护实施决策与进度

- 详细只读设计：`/private/tmp/cuerelay-data-protection-plan-20261122.md`。不改既有33场景，不新增UI/API/重试或幂等契约。
- 撤权由独立 organizer 登录并真实 DELETE 成员，经 focus 观察真实403，保留同一编辑节点、正文、非法时间和完整IndexedDB，ASS备份/取消后仍不发项目写请求；HTTP和Django ORM确认项目未变、成员关系删除。
- 丢响应由 route.fetch 真PUT并核对200/revision2及独立GET后abort；保留revision1草稿。之后新正文手动保存真实409，备份/取消、明确重载，再以revision2保存到3。精确请求序列与最终ORM快照共同验证没有盲目重放或静默覆盖。
- 非法时间不属于合法ASS，按既有契约分别验证输入/IndexedDB保留及ASS只导出已应用文档。
- 定向证据：`/private/tmp/cuerelay-data-protection-targeted-k3fbc9cq/`，2/2通过、Django15.173秒（命令墙钟15.842秒）；清理后仅三个默认库、集群停止无PID。预备沙箱端口绑定失败未启动服务；之后经权限机制在全新集群执行。
- 验证编排：`/private/tmp/cuerelay-data-protection-run-20261122.py`，沿用独立冷缓存公开Vite API、envFile:false、原仓库优化配置；full模式要求35入口。后续完整运行必须新建集群并保留原日志，不能用基线33/33代替。
- 完整验收：`--suite full` 在全新loopback59136集群运行35/35通过；Django245.582秒（命令墙钟246.259秒），失败/错误/跳过/重试均0。35入口各准确运行一个场景、每场全新缓存、无full-reload；代码运行前后/当前哈希一致，默认Vite缓存未改。
- 完整证据：`/private/tmp/cuerelay-data-protection-full-wxx0fhoa/` 的 django.log、metadata.json、verified-summary.json、scenario-results.csv、每场trace/日志/Vite事件和172项artifact-sha256.json。清理后仅三个默认库、stop0/status3/无PID。
- 轻量/静态证据：`/private/tmp/cuerelay-data-protection-checks-20261122/`。四个相关Vitest文件36/36（140ms）、scripts6/6（10.058秒）、typecheck/i18n/JS和Python语法/diff检查通过，公开Vite build envFile:false通过（2.42秒）。没有产品缺陷修复或新依赖，无需扩展本轮范围。
