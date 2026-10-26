# 2026-10-26 审计修复

依据：[审计报告](../reviews/repository-audit-2026-10-26.md)。

## 实施边界

1. F1：使用不依赖 Decimal 精度上下文的绝对值比较；回归覆盖极端指数、非有限值、精确边界、公开转换与持久化失败保留。
2. F2：沿用局部 busy，在请求期间禁用快捷键输入、录制及单项/全部恢复；真实浏览器控制延迟成功/失败响应，验证草稿保留和恢复编辑。
3. F3：API 代理明确限制 3MiB，与 Django 请求预算对齐，保留 1MiB ASS 限制；验证大文档及超限拒绝，记录反向代理实测条件。
4. F4：保留现有严格 v2 校验和迁移整体回滚，不自动规范化或截断历史值。固定 v1 历史快照，提供迁移前只读兼容性检查，列出全部不兼容项目；补充真实迁移状态与混合快照回滚测试。
5. 同步受影响模块与部署文档，修正审计指出的预览依赖说明；运行后端、前端及相关浏览器检查。

## 验证结果

结果见下方最终实际验证。本任务不修改开发库或实际部署配置。

## 已完成

- F1：`copy_abs()` 避免上下文 Overflow 与精度舍入误放行。公开导入/样式变换返回 422；持久化失败保留快照、revision 与操作者。保留普通小数及合法极小数的原有范围。
- F2：请求期间全部快捷键输入、录制和恢复控件禁用；延迟成功仅确认实际提交版本，延迟失败保留草稿/勾选并恢复编辑和录制。
- F3：示例两个 API location 限制 3MiB，超限提供同时适配 issues/error 客户端的 413 JSON。新增可选真实代理测试，不更改系统 Nginx。ASS 本身仍限制 1MiB。
- F4：新增 `check_style_migration`，只读报告所有不兼容项目；固定四份历史快照，三个不兼容样例保持拒绝。真实 MigrationExecutor 验证媒体、revision、身份/时间/Cue 保留及混合快照失败整体回滚；原迁移逻辑未改动。
- 同步格式/项目/账号局部 README、升级与部署文档，并修正 architecture 中 StyleSamplePreview 对 project-data 的现有依赖说明。

## 最终实际验证（2026-10-26）

| 检查 | 结果 |
| --- | --- |
| 全后端 + 真实代理 | **115 项通过**，system check 无问题；PostgreSQL 独立库 `test_cuerelay_audit_checks` 自动创建、销毁。包含权限/Session/CSRF/CAS、多连接竞争、失败回滚、历史迁移和只读预检。 |
| 前端单元测试 | **26 文件、269 项通过**。 |
| 类型与构建 | tsc --noEmit 与 Vite production build 通过。 |
| Chrome 延迟保存回归 | `personal-settings-pending.mjs` 通过；所有快捷键控件 pending 禁用、成功值、失败草稿及恢复录制/默认通过，无页面异常或非预期 API。 |
| Chrome 既有快捷键回归 | `delete-shortcut-settings.mjs` 通过；逗号逐字输入、录制、保存/刷新、覆盖替换、禁用、恢复默认、工作区输入框保护及窄屏通过。Chrome 147.0.7727.101，API 为内存夹具。 |
| Nginx 1.28.0 实际代理 | 从官方源码仅在 /tmp 临时编译，无系统安装；使用仓库示例临时替换端口/上游/文件路径，nginx -t 通过。636,576 B ASS 对应约 1.3MB JSON，真实导入、导出/预览序列化、登录后项目创建/保存通过；/api、转换和项目写入超 3MiB 返回 413 JSON且不改变已保存快照/revision；超过 1MiB ASS 仍返回 422。 |
| 静态依赖与语法 | 前端 101 个源节点/265 条静态相对导入边（含类型），后端 6 个业务包/12 条边无环；ass_format/accounts 无业务包反向依赖，projects/organizations 保持文档边界。Python AST 解析通过。该扫描不覆盖动态导入或第三方内部。 |
| 模型与补丁 | makemigrations --check --dry-run 报 No changes detected；git diff --check 通过。该命令使用占位数据库，迁移历史一致性检查连接不可用，因此不将其计为数据库历史检查通过；真实迁移执行由独立测试库验证。 |

复现命令（数据库变量由本地环境提供，不在记录中保存凭据）：

```sh
# 仓库根目录；Django runner 只使用独立测试库
PGDATABASE=cuerelay_audit_checks NGINX_BINARY=/absolute/path/to/nginx \
  .venv/bin/python backend/manage.py test accounts ass_format http_api organizations projects --noinput --verbosity 1

# frontend；浏览器用例需已启动前端，本次使用独立端口 5187
node node_modules/vitest/vitest.mjs run --no-cache --configLoader runner
npm run typecheck
npm run build
PERSONAL_SETTINGS_URL=http://127.0.0.1:5187 npm run test:personal-settings-pending
DELETE_SHORTCUT_URL=http://127.0.0.1:5187 node browser-tests/delete-shortcut-settings.mjs
```

## 验证边界与后续部署

- 未修改/扫描开发库、旧备份或实际部署配置；真实环境仍需运行只读预检并核对 nginx -T 与外层 ingress 上限。本地临时代理通过不能证明线上配置已生效。
- F4 采用已有文档声明的严格拒绝策略，未扩大公共数据契约，也未静默修复旧值。维护步骤包含导出、备份、隔离调查及定点修复后重查。
- 本次运行相关两项浏览器回归，未重跑全部媒体、长时播放、跨浏览器或所有页面端到端脚本；没有新增 CI 或声称依赖无漏洞。
- 无新增循环依赖或需要本任务继续扩大范围的架构问题。原始审计报告保持不变。
