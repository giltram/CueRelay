# 术语表验证记录（2026-11-12首版）

本文保留当时执行证据；默认独立/按需共享语义已由2026-11-13组织默认+项目fork替换。当前实现和验证见 [组织默认验证](organization-glossary.md)。

日期：2026-11-12（Asia/Shanghai）。使用 no-slop-ui，复用现有主题、设置结构和 QC 侧栏断点；检查了桌面/窄屏截图，未新增导航层级。保留开始前已有的 ASS 兼容性、零时长插入及相关文档/测试改动。本任务未 commit、push、部署，也未修改开发数据库。

## 已执行

| 检查 | 结果 |
| --- | --- |
| `manage.py check --settings=application.test_settings` | 无问题 |
| `manage.py makemigrations --check --dry-run --settings=application.test_settings` | No changes detected |
| `manage.py test accounts ass_format http_api organizations glossary projects diagnostics --settings=application.test_settings --noinput` | 199项，198通过，1跳过 |
| `manage.py test browser_tests.regression --settings=application.test_settings --noinput` | 2项通过，真实 Django/PostgreSQL/Playwright 保存/刷新/冲突 |
| `npm run test -- --run` | 48文件，414项通过 |
| `npm run typecheck`、`npm run build` | 通过；最终 build 包含 TypeScript 检查 |
| `npm run test:glossary` | 通过，最终37次分页查询/84次总请求，零意外请求和页面错误 |
| `npm run test:subtitle-qc`、`npm run test:subtitle-search` | 通过 |
| `npm run test:project-settings`、`npm run test:style-management` | 通过 |
| `npm run test:workspace-history` | 通过，含真实 IME、项目保存/拆分、历史及实例切换 |
| `npm run test:compact-layout`、`node browser-tests/diagnostics-errors.mjs` | 通过 |
| Python AST解析、新 glossary 叶子导入边界检查、前端局部静态导入环检查（12文件）、`git diff --check` | 通过 |

后端新增15项测试（test_glossary 14 + test_glossary_migration 1）：真实双连接首次添加合流、首次添加与显式关联竞争、词条/关联CAS、默认隔离/共享、归档计数与共享更新、member/organizer/dev/跨组织/撤权/CSRF、字段/重复/字面查询/分页、写后注入失败整体回滚、字幕 revision/文档/更新时间不变及旧项目迁移后继续保存。

后端使用新建的临时 PostgreSQL 集群，固定测试角色/loopback55433，Django 各命令创建并销毁独立测试库。Docker daemon 当时未运行，改用仓库现有 PostgreSQL 可执行文件初始化测试集群；没有复用开发数据。验证结束后已停止本次临时 PostgreSQL 集群及 Vite 服务。旧账号/样式迁移测试已适配新增 schema：依据实际已应用状态创建旧账号测试模型，并先正常回退后续 schema 再 fake 撤销不可逆的数据迁移记录。

术语浏览器使用本次专用 Vite5227、真实 Chrome、FFmpeg 合成MP4与唯一 Python ASS codec，术语 HTTP 为内存 fixture。覆盖首次添加/失败保留/提交去重、字面搜索/预填、冲突明确重载/刷新不覆盖草稿、保存成功但刷新失败仍立即展示新值、QC互斥/宽窄布局/上方区域不变、光标/选区/换行隔离/焦点/撤销重做、IME与捕获阶段快捷键隔离、未验证视频限制、共享/归档/管理员切换/零引用表保留，以及真实 App 项目/账号切换和撤权后迟到响应隔离。字幕保存请求计数为零，播放器节点保留，播放/字幕输入不发术语查询。最后补充纯插入规则测试，确认来自API的多行译名在字幕边界使用既有 \N 表示并正确恢复光标；补充后重跑全部414项单元测试及生产构建通过。设置、样式、紧凑布局、诊断旧 fixture 仅补充新增的空术语响应；样式 fixture 另补齐现有 ASS inspect 路径以支持原有导出QC。

## 边界与限制

- 全量后端跳过的1项是既有 Nginx 代理检查：本机未安装 Nginx，不能记为通过。
- 最终生产构建仍有单个 JS chunk 超过500kB的体积提示；本次未引入新运行时依赖或另做拆包改造。
- 专项术语浏览器的 HTTP 是 fixture；真实后端权限、事务和迁移由数据库测试覆盖，既有真实保存E2E另跑。尚未新增术语全链路真实数据库浏览器E2E。
- 未验收 Firefox/Safari、真实长片源或所有网络故障组合。关闭面板结束未保存词条表单，没有持久化表单草稿、多人实时同步或归档快照。
- 正常部署仍需在目标数据库执行 migrate，新增 glossary.0001_initial / projects.0003_glossary_association；本次只在隔离测试库执行迁移。

当前实现未发现额外循环依赖或需要扩大范围的结构性问题。接口、所有权、锁序和保存边界见 [术语契约](../glossary.md)。
