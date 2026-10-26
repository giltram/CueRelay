# CueRelay Repository-wide Audit — 2026-10-26

## 1. Executive Summary

本次为北京时间 2026-10-26 03:00 定时触发的只读审查。基准为审查开始时的 `0f9b1e0`（`add project style settings and fullscreen playback`）；开始时 Git 工作区干净。重点交叉检查了近期样式管理、项目设置、字幕拆分、预览及全屏播放的集成。

**在实际覆盖和验证范围内，没有发现证据足够的 P0/P1 问题。记录 4 项 P2：2 项已证实缺陷、2 项有明确触发条件的风险。** 不据此宣称不存在其他高严重度问题：本次没有运行 PostgreSQL 集成、真实浏览器或部署代理验证。

| 编号 | 严重度 / 类型 | 主要结论 |
| --- | --- | --- |
| F1 | P2 / Confirmed Defect | 非法样式字号 `1e1000000` 绕过预期错误转换，匿名 ASS 导入返回 500。 |
| F2 | P2 / Confirmed Defect | 保存快捷键期间仍能编辑，旧保存响应覆盖其后输入，并显示“已保存”。 |
| F3 | P2 / Design Risk | 按 Nginx 示例部署且继承默认大小限制时，合法 ASS 可导入，但对应文档请求无法导出、预览或保存。 |
| F4 | P2 / Design Risk | 历史版本可保存的部分文档无法通过 v2 升级；已有文档承认严格中止策略，但测试没有验证这些历史有效输入。 |

当前工程具有可继续维护的基础：ASS 纯逻辑与持久化分离，项目写操作集中执行权限、事务和 revision 检查，样式采用稳定 ID 和独立模板快照，媒体分析有 Worker 和缓存预算，文档明确区分当前快照模式与未来实时协作。适合继续受控开发；发布前应修复 F1/F2，核实实际入口的 F3，并在需要从旧版本升级时处理 F4。

本报告不把尚未实现的 WebSocket、租约、审核、不可变历史或通用离线恢复当作现有缺陷。没有自动修复、修改测试、安装依赖、创建迁移、提交或推送。唯一新增仓库文件为本报告。

## 2. Coverage

先阅读根 `AGENTS.md`、`docs/architecture.md`、`docs/invariants.md`，再按下表沿公开接口、调用链及相关测试检查。补充核对 `README.md`、`docs/account-security.md`、`docs/frontend-deployment.md`、`docs/editing-operations.md`、`docs/style-management.md` 和各模块 README。近期提交与旧 codec 通过本地 Git 历史读取，没有切换或修改工作区。

| 范围 | 实际检查的主要文件 / 内容 |
| --- | --- |
| 账号和组织 | `backend/accounts/{models,services,backends,password_validation,shortcuts}.py`、管理命令及相关迁移；`backend/organizations/{models,services,style_templates}.py`；账号、组织和 HTTP 身份测试。检查密码入口、限流、停用、成员变更、组织归属及写入锁顺序。 |
| HTTP 与应用配置 | `backend/http_api/{identity_views,auth_security,project_views,style_views,ass_views}.py`；`backend/application/{settings,urls,admin,identity_admin,apps,asgi}.py`。检查 Session、CSRF、账号一致性头、字段白名单、对象定位、错误转换、请求大小及 Admin 边界。 |
| 项目持久化 | `backend/projects/{models,services,style_services,document_styles}.py`、v2 数据迁移，及 `tests.py`、`test_styles.py`、`test_splitting.py`、`test_style_migration.py` 的相关场景。检查创建、元数据、归档、保存、拆分、样式导入和 CAS。 |
| ASS | `backend/ass_format/{codec,styles,style_operations,splitting,migration,errors}.py`、公开导出和现有测试。检查源模板锚点、Dialogue/Comment、样式引用、脚本设置、序列化、格式拒绝、大小限制和历史兼容。 |
| 前端会话、导航和项目 | `frontend/src/App.tsx`，`account-ui`、`navigation`、`app-workspace`、`project-ui`、`project-data` 的主要状态及请求路径。检查账号切换、过期响应、项目打开、设置与工作区快照隔离、失败保留、显式重载及离页保护。 |
| 编辑和样式 | `workspace-ui/EditorWorkbench.tsx`、`CueTable.tsx`、提交/删除/边界/排序/快捷键纯函数、时间控件、布局组件；`style-ui` 的项目管理器、组织库、模板选择及字段编辑。检查异步提交、草稿、时间输入、拆分、批量操作及失败状态。 |
| 本地媒体、时间轴和预览 | `media` 的本地视频、哈希、manifest、播放路径；`media/audio` 的分段读取、Worker、缓存、频谱和 hook；`workspace-ui/audio-timeline` 的坐标、绘制、边界和区间；`ass-preview` 的会话、渲染器、hook、样本及字体说明。检查资源释放、代次隔离、隐私边界和内存预算。 |
| 验证和交付 | 前端所有现有 Vitest 用例和无输出类型检查；后端纯 ASS / 无数据库 HTTP 用例；依赖声明、锁文件信息、Vite/TypeScript 配置、部署示例、Git 忽略规则及 CI 文件入口搜索。阅读相关浏览器脚本和夹具，区分真实 API 与 mock。 |

这是按模块完成的静态审查和有限动态验证，**不是所有文件逐行穷尽、全分支覆盖或完整端到端验收**。测试、浏览器夹具及文档按相关场景阅读；没有逐行审阅锁文件、第三方实现、字体/WASM 二进制和所有历史规划文档。未覆盖部分如下：

- 没有连接开发或生产数据库，没有读取用户数据，也没有运行 PostgreSQL 建库、迁移、锁竞争和事务故障注入。相关源码及已有测试可提供设计证据，不能代替本次运行结果。
- 没有启动/操作现有开发服务、Nginx 或浏览器；没有真实视频长时运行、跨浏览器、全屏像素、原生解码器内存和交互性能测量。既有浏览器脚本会产生媒体、截图、结果文件，部分要求播种数据库，故跳过。
- 没有执行构建、自动格式化、产生缓存的 Lint 或安装命令；没有外部依赖漏洞数据库扫描，不作“依赖无漏洞”的结论。仓库中未找到受版本控制的 GitHub Actions / GitLab CI 配置，也未找到独立 Lint script；这不能证明外部 CI 不存在。
- 前端导入图及后端业务包依赖扫描不覆盖动态导入字符串、运行时注册、反射或第三方库内部关系。

## 3. Findings

### P0 / P1

没有在本次范围内确认达到 P0/P1 的问题。未确认跨组织越权、revision 绕过、静默覆盖项目数据或不可恢复数据丢失。该结论受上述数据库及端到端验证限制。

### F1 — P2：样式数值验证中的 Decimal 运算异常导致公开转换接口 500

- **类型：Confirmed Defect。**
- **位置：** `backend/ass_format/styles.py:40–48`，尤其第 45 行；HTTP 调用链为 `backend/http_api/ass_views.py:27–36`。
- **触发：** 取得 `empty_document()['source']`，将默认 Style 中字号 `28` 改为 `1e1000000`，保持其他字段不变；匿名 POST `/api/ass/import`，JSON 为 `{"source": "上述 ASS"}`。输入远小于请求大小上限。
- **实际结果：** `Decimal(...)` 构造成功，但 `abs(number)` 受 Decimal 上下文限制而抛出 `decimal.Overflow`。当前 try/except 只围绕构造且只处理 `InvalidOperation`，因此异常没有转换为 `AssError`；HTTP 层的 422 处理也无法捕获。实际 Django 进程内 Client 请求得到 **500**。
- **影响：** 无效或人为构造的字幕使转换失败并触发服务器异常，而不是返回带字段含义的 422。相同验证器还被其他样式路径复用。没有证明数据库损坏、持续拒绝服务或敏感信息外泄，不将其提升为安全高危。
- **最小合理修复：** 使用不会依赖精度上下文舍入/溢出的大小检查（例如有限性检查后用 `copy_abs()` 比较），或先限制支持的数字语法和指数；将可能发生的 Decimal 异常统一转换为格式错误。不要只在 HTTP 顶层吞掉所有异常。
- **建议验证：** 参数化覆盖超大正负指数、非有限值、边界附近数值、普通合法小数；公开导入/样式转换应返回 422 而非 500。持久路径应验证失败不改文档和 revision。
- **证据与限制：** 纯 parser 和真实 Django HTTP 适配层均已在内存中复现；没有访问数据库。持久样式操作的异常影响仅沿共用调用链确认，没有实际数据库请求。

### F2 — P2：快捷键保存响应覆盖请求期间的新输入

- **类型：Confirmed Defect。**
- **位置：** `frontend/src/account-ui/PersonalPanel.tsx:59–62`、`:74–79`；外层禁用条件见 `frontend/src/account-ui/SettingsPage.tsx:31` 的 `fieldset disabled={!enabled}`。
- **触发步骤：** 在个人设置将“提交并下一条”的绑定改成 `Shift+KeyT`，点击保存；延迟 `/me/settings` PATCH 响应；在请求完成前把同一输入改成 `Shift+KeyY`；再让原响应返回 T。
- **实际结果：** 保存按钮禁用，但快捷键输入、录制和恢复默认控件仍可操作。第 79 行无条件以旧请求响应重置全部 shortcut drafts；Y 被改回 T，界面显示“已保存”。新输入没有发给后端，也没有保留为未保存草稿。
- **影响：** 保存期间的设置编辑丢失，慢网络下可稳定触发。范围是个人快捷键草稿，未证明字幕或项目数据受影响。
- **最小合理修复：** 与现有音频选择框一致，在保存期间禁用快捷键输入、录制及单项/全部恢复控件；若产品要求保存时继续编辑，则按草稿代次合并响应，并只确认实际提交的版本。
- **建议验证：** 用可控 deferred Promise 的组件测试或浏览器拦截，验证保存期间继续输入、录制、恢复默认的行为，以及失败后草稿保留；检查“已保存”只指向已提交版本。
- **证据与限制：** 在不写文件的 Node VM 中加载真实组件及快捷键模块，仅替换 React state/element 接口和请求为内存测试桩，实际执行事件处理器。结果为 `pendingInputDisabled=false`、`draftDuringSave="Shift+KeyY"`、`draftAfterResponse="Shift+KeyT"`、提交值 T、消息“已保存”。这验证了状态转移，未替代真实 React 渲染、DOM 禁用语义或浏览器端到端测试；外层代码检查未发现以该局部 busy 禁用输入的机制。

### F3 — P2：Nginx 默认请求限制与合法文档 JSON 大小不一致

- **类型：Design Risk；适用于采用示例且没有更大父级限制的部署。**
- **位置：** `deploy/nginx.conf.example:3–15`；对照 `backend/application/settings.py:71`、`frontend/src/project-data/ass-api.ts:35–40`。
- **触发：** 将示例放入未另设 `client_max_body_size` 的 Nginx http 上下文。构造 600 条、每条 1000 个 ASCII 字符的合法 Dialogue，使用默认模板。实测 ASS 为 **636,576 字节**，可通过 1MiB 格式限制；解析后源模板和结构化 cues 同时进入文档，紧凑 `{"document": ...}` JSON 达 **1,301,951 字节**。
- **预期失败链：** 导入的 source 请求小于 1MiB；后续导出、实时预览序列化及同类完整文档保存请求大于 1MiB。示例未设置大小限制，将继承 Nginx 默认 `1m`，返回 413，先于 Django 的 3MiB 限制。默认值和超限行为依据 [Nginx 官方文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)。
- **影响：** 同一份受支持字幕会出现“导入成功，预览/导出/保存失败”。本地工作区依赖服务器序列化导出，用户可能在无法保存当前编辑的状态下离开页面；本次未实际观察到草稿丢失，不声称已经造成数据损失。
- **最小合理修复：** 在 API 代理范围明确配置与 Django 3MiB 请求预算一致的上限，保留独立的 1MiB ASS 输出限制，并将这两个不同的大小概念加入部署验收。无需无限放大或关闭限制。
- **建议验证：** 经实际反向代理提交此夹具，验证导入、导出、预览和授权项目保存；同时检查真正超过请求预算的载荷仍被拒绝并向用户提供明确错误。
- **证据与限制：** 已实际测量紧凑 UTF-8 JSON 字节数；直达 Django Client 的导入与导出均为 **200**。没有启动 Nginx，也没有检查实际部署的父级配置；若上层已设置足够上限，该部署不受影响。部署文档已说明示例不是完整上线配置，故记录为条件性风险而非已确认线上故障。

### F4 — P2：v2 升级收窄历史输入范围，缺少相应历史兼容夹具

- **类型：Design Risk（附具体 Test Gap），不认定为迁移导致的数据丢失。**
- **位置：** `backend/ass_format/migration.py:10`；`backend/projects/migrations/0002_document_styles_v2.py:8–12`；新增严格约束见 `backend/ass_format/styles.py:30–33`、`backend/ass_format/codec.py:143–154`；测试基准见 `backend/projects/test_style_migration.py:18–25`。
- **触发：** 从 `f34c767^:backend/ass_format/codec.py` 加载 v1 parser/serializer，在默认 ASS 上分别构造：① `PlayResX: 0640`；② 101 字符的样式名称；③ 两条相同的 `PlayResX: 640`。三个文档均通过历史 parse + serialize，但当前 `upgrade_legacy_document` 分别因 PlayRes 格式、样式字段长度、重复 PlayRes 而拒绝。
- **影响：** 若待升级数据库中含这类历史可保存快照，单条即可让整个 RunPython 停止，延长维护窗口。迁移故意整体回滚而非跳过文档，是正确的保护措施；没有证据表明失败会删除或部分覆盖数据。
- **契约核对：** `docs/style-management.md` 已明确严格支持范围和异常文档整体中止/调查要求，并记载本地开发库曾成功升级。因此不能仅凭复现推断当前数据库需要修复，也不将已经声明的拒绝策略定为 P1 回归。风险在于旧版本可接受范围更宽，而现有成功迁移夹具主要由当前默认文档构造，无法证明真实 v1 输入集合的迁移兼容性。
- **最小合理处理：** 保持失败回滚；补充固定历史夹具和维护窗口前的只读兼容性检查。对语义无歧义的旧值决定是否提供显式兼容转换；对超长名称等不能安全自动处理的情况给出导出、人工调整和升级流程。禁止静默截断、跳过或猜测名称映射。迁移依赖当前可变 codec 的方式也应有历史夹具保护，避免未来收紧校验再次改变旧迁移行为。
- **建议验证：** 在隔离 PostgreSQL 中从实际 v1 迁移状态开始，覆盖这三类输入及混合正常/异常项目，确认成功时媒体/revision/Cue 身份保持，失败时整体回滚，并核对维护前检查能列出全部受影响项目。
- **证据与限制：** 历史代码直接从 Git 读入内存执行，三组历史成功/当前拒绝均已复现；没有连接数据库或执行迁移。实际受影响项目数量未知；是否保留这些旧格式属于开发者兼容策略决定。

### P3

没有为填充等级单列风格、文件长度或未产生具体失败的重构建议。

## 4. Architecture Assessment

**持久化权威与边界。** 当前项目数据仍是一个 `Project.document` 快照，revision 为整体冲突基准。普通保存验证 source/styles/script 与服务端基准一致；样式通过具名操作修改，组织模板导入生成独立副本。沿读取的写入调用链，未发现绕过当前用户/组织/项目检查的第二个公开写入口。项目、模板和成员变更采用显式事务及锁顺序；真实锁行为本次未重跑。

**前端数据流。** 工作区、项目设置和组织模板有不同但显式的状态所有权。设置页使用保存快照，工作区旧 revision 通过冲突阻止覆盖；导入、拆分和样式操作有失败保留逻辑。预览会话有请求取消/过期隔离和渲染生命周期管理。F2 表明账号设置这一较小路径仍需把“当前草稿”与“请求已提交版本”区分清楚，不需要为此引入全局状态框架。

**媒体与隐私。** 项目媒体 DTO 限定 SHA-256、大小和时长，不接受路径或视频字节；ASS 转换上传字幕文本，本地视频/音频通过 File、Blob 和 Worker 处理。看到分段读取、PCM/缓存预算、取消和释放机制，以及同源字体和禁用自动字体查询的渲染配置。没有发现媒体上传调用链；这不是对浏览器或第三方库全部网络行为的运行时证明。

**依赖与文档。** 前端相对导入图、后端跨业务包图未检出环；后端主方向为 application → HTTP → accounts/organizations/projects/ass_format，projects → organizations/accounts/ass_format。ASS 不依赖 ORM。存在小范围文档偏差：`docs/architecture.md:66` 称 ass-preview 不依赖 project-data，但 `frontend/src/ass-preview/StyleSamplePreview.tsx:3` 直接导入 `exportAss`。核心 hook 仍支持注入，当前未形成循环或第二个序列化器，故不将其单列为行为缺陷；后续可同步文档或由样本组件上层注入。

`http_api/project_views.py` 直接读取项目 ORM；架构文档后半部的公开命令/查询边界属于未来完整设计，不能把未拆查询模块单独判为当前 Bug。暂未发现需要立即大规模重构的证据。

**验证可维护性。** 纯函数测试覆盖较多，另有真实 PostgreSQL 和合成浏览器测试源码，但本次只执行其中无持久副作用的部分。浏览器 mock 能验证 UI 分支，不能独立证明 Session/CSRF、事务和真实代理集成。仓库内未找到 CI 编排配置，应确认是否有外部流水线实际执行这些检查；不能把文档中的历史通过记录当成本次通过。

## 5. Verification

### 本次实际执行

| 验证 | 命令或方法 | 结果 |
| --- | --- | --- |
| 无数据库后端测试 | 下面的 Django test 命令 | **31 项通过**，system check 无问题；仅 `ass_format` 和 `http_api.tests`，不包含需数据库的 `http_api.test_identity` 等。 |
| 前端类型检查 | 在 `frontend` 执行 `node node_modules/typescript/bin/tsc --noEmit` | 退出码 0。 |
| 前端单元测试 | 在 `frontend` 执行 `node node_modules/vitest/vitest.mjs run --no-cache --configLoader runner` | **26 个文件、269 项通过**；禁用缓存，避免常规配置打包产生文件。 |
| 静态源检查 | Python AST 解析、前端本地导入与后端业务包依赖提取 | 扫描范围内未发现语法解析错误或依赖环；不等于完整运行时模块分析。 |
| F1 | 真实纯 codec + Django 进程内 Client | 极端字号产生 Decimal Overflow；匿名导入 HTTP 500。 |
| F2 | 真实 TSX/快捷键代码经现有 Rolldown 内存转换，在 VM 中执行事件处理器，hook/request 为测试桩 | 重现请求期间 Y 草稿被 T 响应替换；非浏览器测试。 |
| F3 | 构造 600 行文档，测量 UTF-8 紧凑 JSON，并请求纯转换 HTTP 入口 | source 636,576 B；文档请求 1,301,951 B；直达导入/导出均 200。Nginx 部分为官方规则与配置推导。 |
| F4 | Git 历史 v1 codec 内存执行，与当前 upgrade 比较 | 三个历史有效输入均在当前升级失败。 |
| 交付文件检查 | `git diff --check`、`git status --short --untracked-files=all`，另对未跟踪报告检查尾随空白和七个必需章节 | 无已跟踪文件改动；仅新增指定报告，未检出报告尾随空白。 |

后端测试命令（仓库根目录）：

```sh
DJANGO_SECRET_KEY=audit-only-not-for-deployment \
PYTHONDONTWRITEBYTECODE=1 \
PGHOST=127.0.0.1 PGPORT=1 PGDATABASE=audit_no_database \
.venv/bin/python -B backend/manage.py test ass_format http_api.tests --verbosity 1
```

没有加载 `.env`；Python 禁止写字节码，数据库配置指向未使用的隔离占位目标，实际运行用例不申请数据库。HTTP 复现用 Django Client、临时 `ALLOWED_HOSTS=['testserver']` 和上述环境，在进程内调用无持久化接口，不发送网络请求。

F3 构造方式可复现如下（在配置好 Python 导入路径的内存会话中）：

```python
import json
from ass_format import empty_document, parse_ass
base = empty_document()['source']
line = ('Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0000,0000,0000,'
        + 'a' * 1000 + '\n')
source = base + line * 600
document = parse_ass(source)
body = json.dumps({'document': document}, ensure_ascii=False, separators=(',', ':'))
print(len(source.encode('utf-8')), len(body.encode('utf-8')))
```

验证工具也有失败尝试：首次前端内存复现装载器未成功，随后尝试旧 TypeScript 编程接口失败（安装版本没有该旧导出），最后改用已安装 Rolldown + VM 成功；这些失败不计为应用缺陷或验证通过。初次 login shell 出现 pyenv rehash 权限警告，后续使用非 login shell；类型检查本身退出 0。部分批量读取输出截断后对关键位置定向重读，没有把未见输出当作证据。

### 跳过与结论边界

没有运行数据库测试/迁移检查、浏览器回归、Vite 构建、Nginx 实测或依赖审计。原因分别是会创建/修改数据库或其他文件、需运行外部服务/浏览器产物，或超出本次可安全验证条件。没有使用 SQLite 替代 PostgreSQL 来声称事务正确。没有将仓库历史验收记录复制为本次结果。

## 6. Prioritized Action Plan

1. **优先修复 F1。** 改正数值边界校验并覆盖公开接口失败路径；改动小，能消除可由匿名输入稳定触发的 500。
2. **随后修复 F2。** 统一快捷键控件的 pending 行为，增加延迟响应测试，避免“已保存”掩盖新草稿被覆盖。
3. **对外部署前验证 F3。** 核对实际 ingress/Nginx 有效大小限制；用大于 1MiB 的合法文档 JSON 经过真实入口验收，而不是只测小字幕或直连 Django。
4. **下一次旧库升级前处理 F4。** 固定历史测试夹具、决定兼容边界并做只读预检；若所有环境已升级且无旧库恢复需求，可降低近期优先级，但保留升级回归保护。
5. **安排独立验证环境补足本次未执行项。** 先跑 PostgreSQL 权限/CAS/并发/回滚与迁移测试，再跑会话、项目设置/样式、拆分、媒体/预览浏览器回归。确认这些是否由现有外部 CI 执行；若没有，再将已存在的检查纳入流水线。

可以推迟：小范围依赖文档同步、查询层整理及没有具体失败证据的组件拆分。不要仅按文件行数重构，也不需要为本报告追加未授权的新协作功能。

## 7. Open Questions

- 是否仍有尚未升级的部署、旧数据库备份或需要从 v1 重新迁移的环境？决定 F4 的现实优先级；本次未查询任何数据库。
- 对 v1 接受而 v2 拒绝的格式，产品要求无损兼容迁移，还是允许维护前显式整理？尤其超长样式名称不能静默截断。
- 实际部署入口是否已统一设置大于默认 1MiB、与 Django 对齐的请求上限？仓库示例不能回答线上有效配置。
- 是否已有仓库之外的 CI 执行 PostgreSQL 和浏览器测试？若有，需要明确哪些现有命令是发布门禁。

以上问题仅记录，不阻塞本次无人值守报告交付。
