# 工作区 review 定向复核与修复

来源：[2026-11-16 review](../reviews/workspace-review-0f9b1e0-2026-11-16.md)。仅处理 F1–F3，保留当前工作区既有改动，不提交或推送。

再次反馈已复现并修复：新增成功语言选择与首次 GET / 后续远端 GET 的两种返回顺序回归，先确认失败；将语言 choice 的待保存、成功、失败及临时伪语言生命周期明确区分，成功后只在设置尚未 ready 时临时展示，ready 后直接采用 App.saved，无需等待值相等。失败重试/账号隔离及既有设置竞争验证结果见文末。

后续反馈两项均已复现并补修：`settings-response-races.mjs` 验证登录后的首次 GET 与语言保存、音频/快捷键旧 PATCH 与语言保存交错。最终改为按实际写入字段接纳 PATCH、按字段版本合并 GET 并完成 ready；保留首次加载期间已保存的语言选择。补修结果见文末，取代首轮 F2 的整体快照版本方案。

执行顺序：

1. 阅读架构、模块契约和现有测试，以新增回归分别复现 F1（会话失效后的普通导出）、F2（旧设置 GET 晚于语言 PATCH）、F3（孤立 surrogate）。
2. 将纯字幕 QC/导出与账号编辑门禁分开；在 App 设置读写边界用成功写入的版本隔离旧 GET，保留后续刷新；剪贴板编码错误复用现有 AssError/422 契约。
3. 运行定向浏览器、纯函数/HTTP、前端全量单测、类型和构建检查，复查模块依赖并记录实际结果。

## 首轮逐项结论及修复（F2 方案已由文末补修取代）

三项均成立；结论来自本轮代码核对和修复前失败测试，未用原报告的通过结果替代执行。

| 问题 | 修复前实际结果 | 定向修复 |
| --- | --- | --- |
| F1 会话失效后普通导出静默退出 | 新浏览器回归在会话失效提示出现、按钮启用后等待下载超时；代码确认 qc.run 因 enabled=false 返回 null | EditorWorkbench 的 qcEnabled 不再依赖 shortcutsPaused；术语查询/插入单独保持原门禁。普通导出继续走 QC 和原序列化器 |
| F2 旧 GET 覆盖已保存语言 | 延迟旧设置 GET，完成 en PATCH 后释放 GET；新回归实际得到 selector=zh-CN，断言 en 失败 | App.acceptSavedSettings 在接纳语言/个人设置/手册写入时增加内存版本；loadContext 的旧版本只丢弃设置快照，继续刷新组织。账号 epoch/PATCH 序列隔离保持原契约 |
| F3 孤立 surrogate 变成 500 | 纯函数回归得到 UnicodeEncodeError；真实 Django Client 对高/低 surrogate 及正文中 surrogate 均返回 500 | clipboard 的 UTF-8 字节校验捕获 UnicodeEncodeError，转换为现有 server.assContainsInvalidUnicode / AssError / issues 422；不替换非法字符 |

首轮 F2 的成功写入版本覆盖了原报告的已加载设置时序，但后续反馈证明整体丢弃 GET 会使首次加载不完成，且整份 PATCH 仍可能覆盖其他并发写入。不能把原复现通过视为全部设置竞争已解决；最终按字段合并契约见下文。

## 本轮实际验证

前端命令在 frontend 目录，Python 命令在仓库根目录执行。浏览器使用隔离 HTTP fixture，ASS 转换使用真实 Python codec；不将其称为真实数据库 E2E。

| 验证 | 结果 |
| --- | --- |
| `node browser-tests/workspace-review-regressions.mjs`，Vite dev 5240 | 4 个场景通过：会话失效导出及警告继续；GET 在语言保存前/后返回、写入期间启动；各场景继续验证后续远端语言刷新 |
| 同脚本，`WORKSPACE_REVIEW_URL=http://127.0.0.1:5241`，production preview | 4 个场景全部通过；F1 额外断言格式错误阻止继续导出、下载包含未保存正文、编辑器 DOM 保留；无页面异常 |
| `SUBTITLE_QC_URL=http://127.0.0.1:5240 npm run test:subtitle-qc` | 通过，18 次 inspect，包含 5000 行、迟到结果/失败恢复/只读/下载/响应式；errors 和 unexpected 均为空 |
| `SESSION_URL=http://127.0.0.1:5240 npm run test:session-observation` | 两个既有会话竞争场景通过 |
| `npm test -- --run` | i18n:check 通过；56 文件、481 测试全部通过，含前端依赖环与 diagnostics 边界检查 |
| `npm run typecheck` | 通过 |
| `npm run build -- --outDir /tmp/cuerelay-review-fixes-1116-dist` | 通过（含 i18n:check / TypeScript）；保留既有 >500kB bundle 提示 |
| `.venv/bin/python backend/manage.py test ass_format http_api.test_clipboard http_api.test_qc http_api.test_ass_compatibility --settings=application.test_settings --noinput -v1` | 79 项全部通过，system check 无问题；包含新增纯函数/HTTP surrogate 回归、中文/emoji 往返和 UTF-8 字节超限；无需数据库 |
| 本轮涉及的 tracked 文件 `git -c core.whitespace=cr-at-eol diff --check -- …` | 通过；沿用仓库已有 CRLF 约定 |

初次扩大后端集合时包含需数据库的 http_api.test_i18n，因测试 PostgreSQL 连接受限而在建库阶段失败，未计为通过；随后移除该不相关数据库标签，以上纯格式/HTTP 集合完整通过。本轮未启动数据库、未连接开发或生产库，也未执行全量数据库回归。

后端生产代码没有新增 import 边，前端只在原模块/组合根内修复；没有新增循环依赖、接口、迁移、持久化或运行时依赖。模块 README 与 architecture.md 已同步。未发现需要随本任务扩展的架构重构；原报告未覆盖的平台/真实媒体/生产部署范围保持未验收。

构建、单测和后端/QC 日志位于 `/tmp/cuerelay-review-fixes-1116-{dist,build.log,unit.log,backend.log,qc.log}`，可能被系统清理；关键结果已归档于本文件。临时 dev/preview 服务验证后停止。

## 后续反馈复核与最终设置接纳契约

### 修复前证据

两项均由本轮新增浏览器测试复现，而非只依据反馈推断：

- **首次加载回归成立。** 从匿名深链接登录，保留首次 GET 响应，保存 en 后释放 GET；服务器已为 en，但 `.shortcut-row` 始终未挂载，页面停留「正在加载设置…」，语言选择为 System。原因是旧整体版本分支同时跳过了 setSettings 和 setSettingsReady；语言 hook 又在 ready=false 时清除了成功选择。
- **其他 PATCH 覆盖语言成立。** 音频 PATCH 已提交并生成中文完整响应、暂不送达；语言 PATCH 成功保存 en 后释放旧音频响应，实际选择器得到 zh-CN，新测试的 en 断言失败。原因是 PersonalPanel 将整个结果交给 App.setSettings，未区分本次写入字段。

### 最终实现

- `App.acceptSavedSettings(changes: Partial<Settings>)` 仅合并本次成功写入字段，并增加这些字段的内存版本。语言只传 language_preference，手册只传 handbook_seen，音频只传 audio_display_mode，快捷键只传 shortcut_overrides / mouse_sets_cue_boundary。字段取服务端响应中的规范值，不直接假定提交值已保存。
- `loadContext` 在请求前复制字段版本，返回后保留期间已写入的字段、接纳其他字段，并完成 settingsReady。首次 GET 不再整体丢弃；后续新 GET 仍能更新所有未发生新本地写入的字段。账号 epoch 检查和组织刷新保持原有职责。
- `use-language-preference` 的最终生命周期为 pending/saved/failed/transient 单状态；成功 choice 仅桥接 ready=false，ready=true 后立即显示 App.saved 并清理已完成 choice，不再等待值相等。上轮「等待 ready/saved 与 choice 一致」的释放条件已由文末再次补修取代。
- SettingsPage / PersonalPanel 的内部 onSettings 回调改为 Partial<Settings>。HTTP 仍返回完整设置，不新增端点、字段、迁移、模块依赖或持久化。

### 补修实际验证

| 验证 | 本轮结果 |
| --- | --- |
| 新增 `node browser-tests/settings-response-races.mjs`，dev | 4 场景通过：登录后首次 GET+语言保存、旧音频 PATCH+新语言、旧快捷键 PATCH+新语言、旧语言 PATCH+新音频 |
| 同脚本，`SETTINGS_RACES_URL=http://127.0.0.1:5241`，production preview | 4 场景通过；首次加载读取非默认音频/鼠标/快捷键，立即保持 en，且仅用一次 GET 完成；其他场景经表单重挂载断言 App 的合并状态，不依赖局部草稿或第二次 GET |
| 既有 `workspace-review-regressions.mjs`，dev 和 production preview | 每轮 4 场景全部通过，包括普通导出、QC 格式门禁、原 F2 三种 GET/PATCH 顺序及后续远端刷新 |
| `PERSONAL_SETTINGS_URL=http://127.0.0.1:5240 npm run test:personal-settings-pending` | 通过；请求中控件冻结、失败草稿保留、成功值确认、恢复编辑；errors/unexpected 为空 |
| `SESSION_URL=http://127.0.0.1:5240 npm run test:session-observation` | 既有 2 场景通过 |
| `I18N_URL=http://127.0.0.1:5240 npm run test:i18n` | 78 个检查通过，含账号切换/旧账号语言回包隔离、编辑/历史/媒体状态保留；截图仍是待人工审阅证据，不自动批准视觉基线 |
| `npm test -- --run` | i18n:check 通过；56 文件、481 测试全部通过，含依赖环与 diagnostics 边界检查 |
| `npm run typecheck` | 通过 |
| `npm run build -- --outDir /tmp/cuerelay-settings-followup-dist` | 通过，含 i18n:check/TypeScript；既有 >500kB bundle 提示保持 |

本轮仅修改前端及相关文档；未重跑后端/数据库测试，不以首轮 79 项当成本轮结果。浏览器 API 为隔离 fixture，无开发/生产数据库访问。新脚本不使用真实媒体；既有 i18n 套件使用自生成媒体。生产构建与日志在 `/tmp/cuerelay-settings-followup-*`；i18n 产物为 `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-i18n-btrc0K`。临时 dev/preview 服务验证后停止，未提交或推送。

结构复查：字段所有权继续归 App，PersonalPanel 只报告本次保存字段，i18n hook 只管理语言选择生命周期；没有新增 import 边或循环依赖，无需扩大架构重构。

## 再次反馈：成功 choice 遮蔽远端偏好

**结论：成立，是上轮 hook 修改引入的回归，已复现并修复。**

修复前运行 `node browser-tests/settings-response-races.mjs remote`：匿名登录并延迟首次设置 GET，保存 en 成功，再让服务器偏好改为 zh-CN，由新 GET 完成初始化。设置表单已可见，但选择器仍为 en，测试期望 zh-CN 失败。日志保留于 `/tmp/cuerelay-language-choice-before.log`；该测试验证的是真实 App 控制流，HTTP 为可控 fixture。

原因是原 choice 无成功状态，显示始终优先本地选择，清理又要求 saved 与 choice 相等；不同的有效远端值永远无法接管。最终规则不再依赖值相等：

- `use-language-preference.ts` 用一份 AccountChoice 状态替代分离的 choice/status，显式记录 pending / saved / failed / transient。
- pending 和 failed 保留用户选择及失败重试；transient 保留开发伪语言而不持久化。
- saved 只在 ready=false 时桥接首次加载。ready=true 后渲染立即使用 App.saved，再由 effect 清理同一个已完成 choice。即使新 GET 的远端值不同，也不被成功本地选择遮蔽；清理不会抹去后续新选择。
- App 的按字段 GET/PATCH 接纳逻辑、账号/请求序列保护及 HTTP 契约不变，没有新增 import 或运行时依赖。

### 本次实际验证

| 验证 | 结果 |
| --- | --- |
| `node browser-tests/settings-response-races.mjs`，dev | 7 场景全部通过，含原 4 场景与新增 3 场景 |
| 同脚本，`SETTINGS_RACES_URL=http://127.0.0.1:5241`，production preview | 7 场景全部通过。新增覆盖远端 GET 先/首次 GET 先两种返回顺序；完成后再刷新两次，页面/选择器/服务器均为 zh-CN。生命周期场景覆盖 pending/failed 经初始化保留选择、失败后重试成功、随后接受新远端值 |
| `WORKSPACE_REVIEW_URL=http://127.0.0.1:5241 node browser-tests/workspace-review-regressions.mjs` | 原 4 场景全部通过；生产构建共 11 个定向场景通过 |
| `I18N_URL=http://127.0.0.1:5240 npm run test:i18n` | 78 个检查通过，含匿名偏好、伪语言、旧账号回包隔离和编辑/历史/媒体状态保留；截图仍是待人工审阅证据 |
| `PERSONAL_SETTINGS_URL=http://127.0.0.1:5240 npm run test:personal-settings-pending` | 通过，errors/unexpected 为空 |
| `SESSION_URL=http://127.0.0.1:5240 npm run test:session-observation` | 原 2 场景通过 |
| `npm test -- --run` | 56 文件、481 测试通过，含 i18n:check 和前端依赖环/边界检查 |
| `npm run typecheck` | 通过 |
| `npm run build -- --outDir /tmp/cuerelay-language-choice-dist` | 通过，含 i18n:check / TypeScript；仍有既有 >500kB bundle 提示 |

本次只修改语言 hook、浏览器测试及相关文档，未运行后端或数据库回归。新用例不访问真实数据库或媒体；既有 i18n 用自生成媒体。构建及日志位于 `/tmp/cuerelay-language-choice-*`，i18n 产物位于 `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-i18n-N3jGXu`。临时 dev/preview 服务验证后停止。未提交或推送。
