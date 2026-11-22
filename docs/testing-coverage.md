# 已实现功能测试覆盖矩阵

快照：2026-11-22，统一入口现有 **52 场景**（此前45 + 本轮辅助/故障7）。本页通过产品入口、公开契约和测试断言建立索引；实际运行及证据由 [testing.md](testing.md) 和 [本轮计划](plans/e2e-aux-media-failures-2026-11-22.md) 维护。其余独立专项/下层测试的存在不等于本轮执行，不计算覆盖百分比。

范围以 [架构入口的当前实现](architecture.md#当前可运行入口)、模块 README、`frontend/src/navigation/routes.ts` 和 `backend/application/urls.py` 为准。当前是手动保存的整文档 revision、内存撤销历史及本机恢复副本；实时协作、审核、租约、事件重放和服务端修改历史尚未实现，不列为功能缺口。

## 如何阅读与维护

- **真实 E2E**：Chromium → Vite 代理 → Django Session/CSRF/API → PostgreSQL。统一入口为 `backend/browser_tests/regression.py` 的 `WorkspaceRegressionTests`，`frontend/regression/playwright.config.mjs` 管理浏览器与 Vite。局部故障注入会另行说明；本地工作区的格式 HTTP / IndexedDB 路径并不验证项目落库。
- **独立真库脚本**：旧 `browser-tests` 中也有真实后端流程，需单独准备专用播种库、服务和 `BROWSER_TEST_PASSWORD`；不计入上述 52 场景，也不能由统一套件结果推定它们通过。播种入口为 `backend/browser_tests/seed.py`、`seed_projects.py`。
- **浏览器专项**：真实 Chrome/Chromium、DOM、媒体、Worker 或 IndexedDB；账号/项目 HTTP 可能是 fixture，格式可能调用真实 Python codec 或无状态 Django HTTP。这类检查不证明数据库权限、事务或持久化。独立 JASSUB WASM 对照是纯引擎检查，不是浏览器 E2E。
- **后端 / 单元**：Django `TestCase` / `TransactionTestCase` 验证数据库及 HTTP 契约，`SimpleTestCase` 验证无数据库转换接口；Vitest 验证规则、状态和适配器。所在同一列不表示全部使用 PostgreSQL。
- 表中 `R/` = `frontend/regression/`，`B/` = `frontend/browser-tests/`，`F/` = `frontend/src/`，`D/` = `backend/`。文件名是可检索入口；`—` 表示本次核对未找到对应层级的场景，不表示没有其他层测试。

按功能契约维护下表，不逐按钮展开。新增场景时同步修改受影响行及下方场景快照；新增实现才扩展功能范围。专项命令及服务要求见 [浏览器测试说明](../frontend/browser-tests/README.md) 和各模块 README。

## 账号、组织与项目

| 已实现入口 / 契约 | 真实服务端 E2E | 浏览器专项 / fixture | 后端集成 / 前端单元 | 关键缺口 / 手工边界 |
| --- | --- | --- | --- | --- |
| 登录、会话恢复、退出、本人密码；Session/CSRF、跨账号写保护 | R/account-settings.spec.mjs 的账号生命周期：错误输入保留→登录→刷新会话→本人改密失败/成功→独立旧会话401→当前会话保持→退出→旧密码拒绝/新密码成功，最终ORM核对两账号密码；冷却例真实5次错误及正确密码429、Retry-After/UI秒数一致、输入保留，ORM核对锁定不续期。既有工作区/SRT会话例及独立 B/user-system.mjs 保留 | B/session-observation.mjs、context-refresh.mjs：重叠会话检查、迟到认证失败与主动登录/退出 | D/accounts/tests.py、D/http_api/test_identity.py：密码策略、冷却/限流、并发登录、CSRF、失效会话、账号一致性；F/account-ui/api.test.ts | 冷却到期/滑动窗口/并发与密码策略细节保留在后端；UI没有倒计时禁用契约，不等待5分钟、不缩短生产规则 |
| 个人设置：快捷键、焦点切换、鼠标边界、音频模式、语言 | R/account-settings.spec.mjs 的 preferences：快捷键/焦点/鼠标/音频保存、刷新、恢复默认及换号隔离；两次明确 abort 注入只模拟未送达的PATCH失败，验证输入和服务器未变，后续成功均真实落库。语言复用 R/workspace.spec.mjs 的英文偏好保存/刷新/工作区保留例 | B/personal-settings-pending.mjs、delete-shortcut-settings.mjs、audio-preferences.mjs、settings-response-races.mjs：局部 busy、失败保留、字段交错响应 | D/accounts/test_shortcuts.py、test_language.py、test_migrations.py；D/http_api/test_identity.py、test_i18n.py；F/account-ui/shortcuts-validation.test.ts、F/workspace-ui/timing-shortcuts.test.ts | 代表字段闭环已补齐；交错响应、全部快捷键别名/IME组合仍由专项和单元验证，不穷举偏好排列 |
| 组织成员、organizer/member/dev、最后活动 organizer、退出与撤权 | R/workspace-drafts.spec.mjs 的退出组织、dev 退出、`organization refresh ignores a late list from before revocation` 使用真实 leave/成员删除；R/data-protection.spec.mjs 的 `workspace revocation preserves local edits and backup` 由独立 organizer HTTP 删除成员，真实 GET 403 后保留正文/非法时间/IndexedDB，禁写并导出完整 ASS，Django 最终核对关系删除及项目未变。独立真库：B/user-system.mjs 验证成员管理与同级保护 | B/context-refresh.mjs、resource-response-races.mjs：403/404、旧响应隔离与恢复 | D/organizations/tests.py、D/http_api/test_identity.py：最后 organizer 并发退出/降级/移除/停用、Admin、跨组织与角色权限 | 新增撤权场景覆盖编辑中成员删除；账号停用、其他角色变化及并发撤权组合主要由后端验证 |
| 项目创建：名称/说明、固定视频摘要、可选 ASS/SRT、同页创建交接 | R/project-management.spec.mjs：空字幕/ASS创建、坏字幕禁提交、无视频禁提交、真实400后名称说明/已验证File保留、仅成功落库、摘要与刷新快照；SRT复用 R/srt.spec.mjs 的创建/保存/恢复例。Django最终核对项目数/source/media/revision | B/video-restore.mjs 验证 SelectedVideo/句柄交接；选择器决定为 fixture | D/projects/tests.py：原子创建、合法媒体、不可变身份；D/projects/test_srt.py；F/media/file-hash.test.ts | 系统picker取消、原生权限与持久句柄恢复需人工/独立专项；setInputFiles不等同于OS选片验收 |
| 项目列表：组织/进行中/过去、搜索、分页、静默刷新 | R/project-management.spec.mjs：两组织active/archived、27条匹配跨页/准确名称及总数、搜索切换重置页码、无匹配/清除、刷新，member无创建/归档入口；最终ORM确认只读未变。既有草稿例继续验证设置失败与退出后刷新 | B/projects-refresh.mjs、resource-response-races.mjs、context-refresh.mjs：列表读取乱序、搜索防抖、分页校正、失败重试 | D/projects/tests.py 的 `test_list_filter_search_pagination_excludes_documents`；F/request-state/read-order.test.ts | 关键组合已补齐；复杂乱序/搜索防抖/页码校正继续由fixture精确控制，不穷举查询排列 |
| 项目设置、名称/说明、归档/恢复与只读 | R/project-management.spec.mjs：名称说明真实400保留→保存→刷新→UI归档→只读设置/样式/成员字幕→恢复可编辑→member保存刷新，revision1→5；member直接PATCH/归档403不变；无视频/错误视频禁写；最终ORM核对。复用已有真实样式竞争和合并归档门禁 | B/project-settings.mjs：成员/管理员、元数据输入保留及显式刷新；B/resource-response-races.mjs：保存/拆分归档确认不被旧 active 解除 | D/projects/tests.py：元数据、revision/no-op、归档/恢复、并发保存与归档；D/projects/test_styles.py | 元数据/归档/恢复代表闭环已补齐；并发归档/权限及旧响应竞争继续由后端和专项验证 |
| 深链接、新标签页、历史前进/后退、隐藏与保留工作区 | R/workspace-drafts.spec.mjs、R/workspace.spec.mjs 的冲突重载、真实设置新标签页；独立真库：B/navigation.mjs 覆盖指定组织直达/刷新、独立标签页与同页保留 | B/workspace-navigation.mjs：保存延迟/失败、取消、明确放弃、beforeunload；B/resource-response-races.mjs：路由/重载乱序 | F/navigation/routes.test.ts、history-navigation.test.ts、RouteLink.test.tsx；F/app-workspace/navigation-transition.test.ts | 原生标签页/浏览器关闭与 beforeunload 受平台限制；52 场景不代表全部导航组合 |

## 字幕文件、编辑与样式

| 已实现入口 / 契约 | 真实服务端 E2E | 浏览器专项 / fixture / 纯 codec | 后端集成 / 前端单元 | 关键缺口 / 手工边界 |
| --- | --- | --- | --- | --- |
| ASS 导入/导出、完整快照保存、元数据锚点/事件顺序、格式拒绝 | R/workspace.spec.mjs 的 `save refresh and history`、R/cue-merge.spec.mjs 项目分支验证保存/刷新/ASS 下载；R/workspace-drafts.spec.mjs 本地分支走真实格式 HTTP 与 IndexedDB。独立真库：B/projects.mjs | B/ass-compatibility.mjs：Python codec + 独立 JASSUB WASM，**无浏览器/HTTP/数据库**；B/workspace-history.mjs 的导入失败与基线检查使用 fixture | D/ass_format/tests.py、test_compatibility.py、test_follow_up.py；D/http_api/tests.py、test_ass_compatibility.py、test_proxy_limits.py；D/projects/test_ass_compatibility.py；F/project-data/ass-api.test.ts | 自制语料与有限 ASS 子集并非任意 ASS 兼容承诺；真实外部制作文件仍需验收；代理超限须实际安装 Nginx 才能验证 |
| SRT 严格 UTF-8/10ms 量化/b-i-u-s、导出损失说明；备份仍为 ASS | R/srt.spec.mjs 三例：本地失败导入保护、项目创建/保存/重载/恢复、英文窄屏/IME/过期会话导出；本地分支验证真实格式 HTTP，项目分支另有真实落库 | R/srt.spec.mjs 的本地导入/下载不构成数据库保存证明；不另设前端 parser | D/srt_format/tests.py、D/http_api/test_srt.py、D/projects/test_srt.py；F/project-data/subtitle-api.test.ts | 仅已声明支持子集；其他编码/标签保护性拒绝，第三方播放器显示与有损导出结果需人工核对 |
| 文本/时间编辑、提交并下一行、插入/删除、零时长、多选与批量行样式 | R/editing-persistence.spec.mjs 的结构例：插入两行/删除零时长行、非连续多选样式、未应用时间保留、保存前服务器不变、显式保存刷新及ORM；既有 workspace.spec.mjs 的G新增/UUID和time-shift/cue-merge多选继续复用 | B/cue-table.mjs、subtitle-line-menu.mjs、editing-operations.mjs、subtitle-focus.mjs、tab-navigation.mjs：选择/焦点/批量样式/时间草稿；其中项目保存可为 fixture，不能当作落库证明 | F/workspace-ui/line-selection.test.ts、line-edits.test.ts、line-styles.test.ts、commit-timing.test.ts、timing-shortcuts.test.ts；D/projects/tests.py 的零时长保存测试 | 关键保存闭环已补齐；所有插入方向/帧边界/原生输入法与快捷键排列不穷举，桌面平台差异需验收 |
| 文本/播放头拆分、裁剪；项目拆分会保存完整快照 | R/editing-persistence.spec.mjs：非空播放头拆分真实拒绝无变更→清空后真split一次revision并刷新→播放头入出点裁剪显式保存刷新；R/workspace.spec.mjs 继续验证文本拆分/撤销不反向保存 | B/editing-operations.mjs、project-split-checks.mjs、boundary-click-checks.mjs：真实 codec + 可控 HTTP，播放头/裁剪/失败保持；由对应专项脚本组合调用 | D/ass_format/test_splitting.py、D/projects/test_splitting.py、D/http_api/tests.py；F/workspace-ui/line-edits.test.ts、playhead-boundary.test.ts | 空文本播放头拆分与裁剪代表闭环已补齐；所有帧前后分割和边界排列由下层/专项保护，本轮unknown-writes补真实拆分丢响应，其他分割/故障组合未穷举 |
| 复制、剪切、粘贴、选择字段覆盖 | R/editing-persistence.spec.mjs 的 clipboard：context授权实际Chromium剪贴板、复制/剪切/粘贴、非法时间覆盖拒绝且保留字段→仅文字/样式覆盖→显式保存刷新；完整请求/GET快照、ASS隐藏字段导出与最终ORM核对 | B/subtitle-line-menu.mjs：真实 Python clipboard codec、选择/覆盖弹窗/失败保留；项目 HTTP 是 fixture | D/ass_format/test_clipboard.py、D/http_api/test_clipboard.py；F/workspace-ui/line-edits.test.ts、line-selection.test.ts；F/media/video-frame.test.ts | 浏览器context授权不代表外部应用交换或OS权限；原生文本框剪贴板/撤权与其他MIME组合由专项/人工验收 |
| 合并字幕行：非连续多选、首行身份/元数据、整批校验 | R/cue-merge.spec.mjs 的项目例：真实预检、ASS 往返、保存/刷新、归档门禁、预览/QC/查找联动 | 同文件本地例：真实格式 HTTP + 浏览器状态，含非法/放弃/隐藏事务取消，不验证项目持久化 | F/subtitle-model/cue-merge.test.ts；F/workspace-ui/line-selection.test.ts；D/ass_format/test_compatibility.py | 有限样本没有证明所有 ASS 元数据组合；大批合并仍受既有格式预算 |
| 批量时间平移：选择/全文、未应用输入保护、一次历史 | R/time-shift.spec.mjs 的项目例：显式保存、草稿恢复、QC/预览 | 同文件本地例：选择、焦点、历史、英文窄屏/键盘/IME，走真实格式 HTTP | F/subtitle-model/time-shift.test.ts；F/workspace-ui/workspace-changes.test.ts | 覆盖声明的时间规则；没有跨浏览器/真实长片全量操作验收 |
| 查找/当前替换/全部替换、字面匹配、格式标签边界、IME | R/subtitle-replace.spec.mjs 项目例：验证媒体后编辑、保留原始时间、显式保存恢复稿、QC/预览 | 同文件本地例：IME、原生 undo、整批历史、预检失败原子性；B/subtitle-search.mjs：查找节点/当前命中/导航恢复（HTTP fixture） | F/workspace-ui/cue-search.test.ts、cue-replacement.test.ts | 复杂输入/浏览器查找冲突主要由专项脚本验证；不扩展为正则或语义查找功能 |
| 内存撤销/重做、输入/手势分组、100 步、保存基准独立 | R/workspace.spec.mjs 的 `save refresh and history`，加 R/time-shift.spec.mjs、subtitle-replace.spec.mjs、cue-merge.spec.mjs：编辑/拆分/保存后撤销与刷新新基线 | B/workspace-history.mjs、workspace-history-projects.mjs：文本/手势/本地样式、隐藏恢复、原生历史边界；HTTP fixture | F/workspace-ui/edit-history.test.ts、history-styles.test.ts、commit-timing.test.ts、workspace-changes.test.ts | 不是服务器历史/跨刷新撤销；所有手势和原生输入事件组合未纳入 45 场景 |
| 样式定义、模板复制/批量属性/脚本/适配、样式与字幕竞争 | R/style-persistence.spec.mjs：组织模板真CRUD/重名400保留；member只读库且POST/PUT/DELETE403；项目双模板copy导入重名422整批不落库/草稿保留后成功；batch仅改字号、copy/assign/rename/删除未用样式、已引用样式禁删、模板改删不影响快照、刷新/ASS/最终ORM。既有 workspace.spec.mjs 的三项真实样式竞争继续复用 | B/style-management.mjs：真实纯 codec/JASSUB 样本预览，模板/项目 HTTP fixture；B/subtitle-line-menu.mjs：批量行样式 | D/ass_format/test_styles.py、D/projects/test_styles.py、test_style_migration.py；F/project-data/project-style-save.test.ts、project-document-save.test.ts；F/style-ui/style-fields.test.ts、F/workspace-ui/history-styles.test.ts | 模板/项目样式代表闭环已补齐；scale/脚本及完整字段组合继续由既有后端/codec/fixture验证，字体/尺寸最终观感需人工 |
| 术语：组织默认表、项目 fork/独立词条、切回默认、侧栏插入 | R/workspace.spec.mjs 的 `organization glossary fork stays isolated`：组织维护→fork→复制/新增词条双向隔离→刷新，字幕 revision 不变 | B/glossary.mjs：搜索/冲突/失败保留、归档、切回默认、光标/选区插入/撤销、IME、账号/项目/撤权迟到响应（HTTP fixture） | D/projects/test_glossary.py、test_glossary_migration.py；F/glossary-data/api.test.ts、rules.test.ts；F/workspace-ui/term-insertion.test.ts | 真实 E2E 代表路径不含所有侧栏插入/分页/切回默认与竞态；并发 fork/撤权事务主要由后端验证 |

## 本机保护、媒体及辅助入口

| 已实现入口 / 契约 | 真实服务端 E2E | 浏览器专项 / fixture / 探针 | 后端集成 / 前端单元 | 关键缺口 / 手工边界 |
| --- | --- | --- | --- | --- |
| 本机草稿：本地/项目、刷新/关闭后恢复、原始时间、保存回执清理 | R/workspace-drafts.spec.mjs：`workspace draft project restores without video and tracks save acknowledgement` 用 `route.fetch()` 真写库后延迟回执；其余本地/未选行/空项目时间/存储失败场景验证真实 IndexedDB，项目场景再核对服务器 | 同文件注入 IndexedDB put/delete 事务失败；本地路径是浏览器+真实 codec，不验证项目写库 | F/workspace-drafts/autosave.test.ts；F/workspace-ui/workspace-changes.test.ts、edit-diagnostics.test.ts | 尚未证明进程崩溃、站点数据被清除、真实配额/权限撤销后的恢复；未完成事务无法保证不丢；延迟回执不等于响应丢失 |
| 重复标签页、关闭来源页后的候选恢复/导出/放弃、账号隔离 | R/workspace-drafts.spec.mjs 的 `workspace draft duplicate tabs`、`workspace draft account isolation`、`removes stale offers`、`concurrent exports`：真实 Web Locks/IndexedDB、登录切换、服务器 revision；账号例在同页切换登录后刷新 | B/context-refresh.mjs 的 account/authentication 组、B/diagnostics.mjs 的账号生命周期；独立真库 B/user-system.mjs 验证跨标签页会话切换/原稿保护 | F/account-ui/api.test.ts、F/workspace-drafts/autosave.test.ts、F/diagnostics/recorder.test.ts | 52 场景不等于所有“旧标签页在途写入×换号”组合；不同浏览器/设备不共享本机恢复副本 |
| 保存冲突、离页保护、备份下载、明确放弃/重载 | R/workspace.spec.mjs 的 `conflict preserves local edits`：真实 409、服务器未被覆盖、非法时间草稿/正文保留、备份/取消/重载；R/workspace-drafts.spec.mjs：晚 revision 冲突、退出失败、删除失败；R/data-protection.spec.mjs：真实撤权，以及 route.fetch 真提交后 abort 响应，旧确认基准/本机稿保留、无自动重试、后续手动 409、完整备份/取消/明确重载后继续保存 | B/workspace-navigation.mjs、resource-response-races.mjs、workspace-review-regressions.mjs：保存失败/延迟、只读/会话失效导出、QC 警告与错误；HTTP fixture | D/projects/tests.py、test_splitting.py 的并发/CAS；F/project-data/project-document-save.test.ts、project-style-save.test.ts；F/app-workspace/navigation-transition.test.ts | 新增丢响应覆盖 document PUT；本轮新增拆分/样式丢响应及有限网络矩阵，完整组合仍未端到端穷举，没有自动网络重试/离线提交队列 |
| 本地视频校验、播放/定位/全屏、导入进度 | R/workspace.spec.mjs 等导入真实合成 MP4、完整 SHA-256 后解锁；R/cue-merge.spec.mjs、time-shift.spec.mjs 检查媒体/预览联动。独立真库 B/main-audio-integration.mjs 检查错误摘要与权限门禁 | B/video-progress.mjs、fullscreen-playback.mjs、cue-table.mjs：真实 video + 身份/项目 fixture | F/media/file-hash.test.ts、playback.test.ts、range-playback.test.ts、video-frame.test.ts | 新增独立media验证180秒/5.1合成媒体（完整规格/预算见testing.md），仍不代表真实片源/设备/全部解码器覆盖；全屏和播放策略仍需目标平台人工验收 |
| 项目本机视频句柄恢复、重新授权、范围隔离与取消 | —；普通 E2E 重新 setInputFiles 不等于句柄恢复 | B/video-restore.mjs：真实 IndexedDB/OPFS 可序列化句柄、完整哈希、刷新/新页/账号项目隔离；系统 picker 与权限决定为 fixture | F/media/file-hash.test.ts；恢复状态与取消主要由浏览器专项验证 | 真实 OS 选片、持久权限、设备移除/站点撤权 UI 需人工；没有完整“真实项目创建→OS 句柄→刷新恢复”真库 E2E |
| 音频提取/频谱/波形、时间轴缩放/拖动/吸附、独立试听与出点跟随 | R/cue-merge.spec.mjs、subtitle-replace.spec.mjs、time-shift.spec.mjs 等确认真实音频 Worker ready；独立真库 B/main-audio-integration.mjs 验证提交/归档/隐藏门禁 | B/local-audio.mjs、audio-lifecycle.mjs：开发探针；B/audio-timeline.mjs（含 ruler/playhead/commit 检查）与 boundary-snap.mjs：正式本地工作区，部分入口需专用真库登录但音频计算不落库；B/audio-audition.mjs、audio-reuse.mjs：真实媒体/声音处理 + HTTP fixture | F/media/audio/local-audio.test.ts、audio-worker.test.ts、analysis.test.ts、spectrum.test.ts、audition-controller.test.ts、audition-reader.test.ts；F/workspace-ui/audio-timeline/viewport.test.ts、ruler.test.ts、boundary-snap.test.ts、spectrum-pixels.test.ts | 52 场景不验证完整声音输出/所有指针手势；稀疏 5GiB 文件只验证寻址，非真实长片解码；本轮media增加180秒六声道与多窗试听；真实长片、设备输出和听感仍需人工 |
| ASS 实时预览、字幕开关、编辑复用引擎、样式样本预览 | R/cue-merge.spec.mjs 项目例检查实际 canvas/像素变化与保存；R/time-shift.spec.mjs 等等待真实 JASSUB ready | B/ass-preview.mjs：真实 JASSUB/WASM + 无状态格式 HTTP，项目/身份 fixture；覆盖播放/seek/非帧对齐边界/全屏/失败恢复；B/style-management.mjs 样本像素；B/ass-compatibility.mjs 为无浏览器独立引擎对照 | F/ass-preview/preview-session.test.ts、jassub-renderer.test.ts；F/workspace-ui/preview-document.test.ts | 字体回退、罕见字符、HDR/VSFilter 与外部播放器逐像素一致性不由这些测试保证；最终成片需视觉 QC |
| 字幕 QC、定位、过期报告与导出预检 | R/cue-merge.spec.mjs、time-shift.spec.mjs、subtitle-replace.spec.mjs：真实 inspect 与编辑联动；R/srt.spec.mjs：SRT 损失提示、继续导出、失败导入保留 | B/subtitle-qc.mjs、workspace-review-regressions.mjs：错误阻止/warning 可继续、失败/过期检查、5000 问题、窄栏与定位（真实纯 codec + HTTP fixture） | F/subtitle-qc/check-subtitles.test.ts、F/workspace-ui/cue-cps.test.ts；D/ass_format/test_inspection.py、D/http_api/test_qc.py | 52 场景没有逐条断言所有 QC 阈值/性能边界；保守规则不能代替叠字意图、语言质量或完整人工 QC |
| 诊断 JSON、账号代次隔离、安全投影、请求关联 | R/auxiliary.spec.mjs：真实密码业务错误→个人设置诊断下载→requestId与隔离后端安全日志对应/同页换号隔离；R/workspace-drafts.spec.mjs继续验证只读时间基准 | B/diagnostics.mjs、diagnostics-errors.mjs：真实下载/IndexedDB、预算/账号隔离/迟到错误，HTTP fixture | F/diagnostics/export.test.ts、recorder.test.ts、errors.test.ts、boundaries.test.ts、http.test.ts、identifier.test.ts；F/workspace-ui/edit-diagnostics.test.ts；D/diagnostics/tests.py | 本轮auxiliary真业务错误/下载/日志关联覆盖已补，结果见文末；未覆盖所有错误来源；脱敏不是任意字幕秘密检测，输出内容仍需人审 |
| 中英/伪语言、设置交错、宽窄布局、分隔栏、长列表窗口化 | R/workspace.spec.mjs 的英文语言例：真实偏好保存、媒体节点/字幕/原始时间保留；R/srt.spec.mjs、time-shift.spec.mjs、subtitle-replace.spec.mjs 本地例覆盖部分英文窄屏 | B/i18n.mjs、i18n-production.mjs、settings-response-races.mjs、compact-layout.mjs、workbench-resize.mjs、cue-window.mjs：语言矩阵/裁剪与命中/节点保留/阈值锚点；HTTP fixture。B/browser-performance.mjs 为生产测量驱动 | F/i18n/i18n.test.ts；frontend/build/i18n-validation.test.ts；F/workspace-ui/cue-window.test.ts、workbench-sizing.test.ts、cue-column-widths.test.ts；F/request-state/read-order.test.ts | 截图第一次输出不是已批准基线；自动几何检查不等于视觉/读屏验收；限速性能不是低端真机，也不是 INP |
| 双语手册、首次提示/账号确认、许可与源码下载入口 | R/auxiliary.spec.mjs：两名新账号稍后阅读/打开确认→刷新持久化/本人隔离；独立production检查手册/许可/真实源码压缩包下载，无.md请求 | B/handbook.mjs：首次提示/稍后阅读/失败/导航/目录与生产无 .md 请求，HTTP fixture；B/i18n-production.mjs 检查英文预编译手册/双语许可页 | frontend/build/handbook-markdown.test.ts：章节/HTML 拒绝/快捷键一致性；D/accounts/test_migrations.py、D/http_api/test_identity.py：本人幂等确认/隔离/CSRF；scripts/test_open_source.py | 本轮auxiliary真账号稍后阅读/打开确认/刷新/隔离覆盖已补，结果见文末；手册可理解性、完整许可下载材料及新截图需人工核对 |

## 此前补齐的数据保护场景（已包含在此前45及当前52场景）

| 优先项 | 既有相近证据 | 新增真实 E2E 证明 |
| --- | --- | --- |
| P1 编辑中撤权后的保留和备份 | R/workspace-drafts.spec.mjs 的组织列表撤权；B/resource-response-races.mjs、glossary.mjs 的 fixture 撤权；D/projects/tests.py / organizations/tests.py 的权限与锁 | R/data-protection.spec.mjs 的 `workspace revocation preserves local edits and backup`，Django 入口 `test_revocation_preserves_local_edits`：独立 organizer 真撤权、focus 观察真实403、原编辑节点/正文/非法时间及完整IndexedDB保留、快捷键禁写、完整ASS下载/取消，HTTP与ORM核对项目未变 |
| P2 服务端提交成功但响应丢失 | R/workspace-drafts.spec.mjs 的项目草稿例已真提交后**延迟并最终释放**回执；F/project-data/project-document-save.test.ts、project-style-save.test.ts 对未知失败不安全重试 | R/data-protection.spec.mjs 的 `workspace lost save response preserves draft and recovers explicitly`，Django入口 `test_lost_save_response_preserves_draft`：route.fetch确认200/revision2及独立GET后abort；未知提示、不接纳revision、不清稿、不自动重试；新本地正文手动保存旧revision真实409、ASS备份/取消、明确重载后revision2→3，最终HTTP/ORM快照一致 |

## 统一真实回归场景快照

以下是代码入口数量，不是本次运行结果。`backend/browser_tests/regression.py` 当前有 52 个 `test_*` 入口；按对应 Playwright 文件分组如下。它们共享真实后端编排，但本地分支只验证格式 HTTP / 浏览器状态，故不能按“52 个功能都已落库验证”理解。

| 场景文件 | 场景数 | 主要范围 |
| --- | ---: | --- |
| [workspace.spec.mjs](../frontend/regression/workspace.spec.mjs) | 7 | 保存/刷新/历史、409 本地保护、三项样式竞争、术语 fork、英文偏好 |
| [srt.spec.mjs](../frontend/regression/srt.spec.mjs) | 3 | 本地导入/下载、项目创建/保存、英文窄屏/会话失效 |
| [time-shift.spec.mjs](../frontend/regression/time-shift.spec.mjs) | 2 | 项目与本地时间平移 |
| [subtitle-replace.spec.mjs](../frontend/regression/subtitle-replace.spec.mjs) | 2 | 项目与本地替换 |
| [cue-merge.spec.mjs](../frontend/regression/cue-merge.spec.mjs) | 2 | 项目与本地合并 |
| [workspace-drafts.spec.mjs](../frontend/regression/workspace-drafts.spec.mjs) | 17 | 草稿/候选/标签页/账号/存储失败、组织退出/刷新、诊断时间基准 |
| [data-protection.spec.mjs](../frontend/regression/data-protection.spec.mjs) | 2 | 编辑中真实撤权、真提交后丢响应、本机保护/ASS备份/明确恢复 |
| [account-settings.spec.mjs](../frontend/regression/account-settings.spec.mjs) | 3 | 登录/改密/旧凭据及会话、真实冷却、偏好失败保留/保存/恢复/隔离 |
| [project-management.spec.mjs](../frontend/regression/project-management.spec.mjs) | 4 | 空/ASS创建、列表组合、元数据/归档恢复/权限/视频门禁 |
| [editing-persistence.spec.mjs](../frontend/regression/editing-persistence.spec.mjs) | 2 | 实际剪贴板、字段覆盖、播放头拆分/裁剪/插删/多选样式保存刷新 |
| [style-persistence.spec.mjs](../frontend/regression/style-persistence.spec.mjs) | 1 | 模板CRUD/member权限、复制导入/批量属性、样式引用快照完整性 |
| [auxiliary.spec.mjs](../frontend/regression/auxiliary.spec.mjs) | 2 | 真账号首次手册确认/刷新/隔离；真实业务错误→设置下载→隔离后端日志requestId关联 |
| [unknown-writes.spec.mjs](../frontend/regression/unknown-writes.spec.mjs) | 2 | split/styles真实提交后丢响应，旧基准/表单/工作台稿保留、明确恢复 |
| [network-recovery.spec.mjs](../frontend/regression/network-recovery.spec.mjs) | 3 | 断网/传输超时/503保留；真实session失效及撤权恢复 |
| 合计 | **52** | 此前45场景保留，本轮新增7条代表闭环 |

核对方法：对照路由/API、模块 README 与测试断言，检查 `route.fulfill` / `route.fetch` / 纯 codec 调用以判别边界，并核对 Django 入口与 Playwright 场景。选择器一一对应的可执行检查为 `scripts/test_regression_selection.py`；此前45个入口/场景一一对应检查、该轮定向10/10及完整冷缓存45/45曾实际执行通过（不作为本轮52场景结果）；耗时、失败修正历史与证据见 testing.md，历史35/35不替代本轮验收。独立专项、真片源、Firefox/WebKit独立实际结果另列；真实Safari、真实 OS 权限/辅助技术和完整网络故障矩阵均不能由统一套件的通过推定已验收。GitHub Actions 仍暂缓。

## 本轮已实现、已运行及未验收（辅助/媒体/故障）

本轮保留此前45场景，新增7条，最终完整52/52已实际执行通过（376.299s，墙钟377.076s），失败/错误/跳过/自动重试均0；每个入口准确一例、各用空Vite缓存。历史45/45仅作基线，原217项artifact哈希已复核保留。完整 [核验摘要](/private/tmp/cuerelay-aux-media-failures-full-chromium-wk6yxrud/verified-summary.json) 与 [逐项CSV](/private/tmp/cuerelay-aux-media-failures-full-chromium-wk6yxrud/scenario-results.csv) 不把发现数当执行数。

| 自动化已完成 | 本轮实际运行通过 | 仍未证明 / 需人工 |
| --- | --- | --- |
| 首次手册稍后阅读/打开确认、本人/账号隔离与刷新；诊断业务错误→设置下载→后端日志关联/换号 | auxiliary2条已在定向和完整中通过；生产手册/许可/真实源码压缩包下载另1/1 | 可理解性、视觉/读屏；任意秘密检测及所有诊断错误来源 |
| split/styles真实提交200后独立GET再丢响应；旧正文/时间/选择/本机稿或表单/基准保留、手动冲突、明确恢复后继续 | unknown-writes2条；原document丢响应及撤权两条也在完整52中重新通过，最后ORM一致 | 其他写入×并发/故障组合；无网络自动重放/离线提交队列 |
| 断网、浏览器传输超时注入、503失败注入、真实session失效/同账号恢复、真实撤权/重新加入恢复 | network-recovery3条；成功恢复均走真实HTTP/PostgreSQL，未fulfill成功 | 产品无自动写入deadline；设备级网络、代理/进程故障与未列组合 |
| 较长合成片分段分析、远seek、JASSUB像素/开关、多窗试听、卸载清理 | 独立media生产1/1：180秒、8,739,168字节、48kHz六声道5.1，3条PCM消息最大2,304,000字节；32MiB分析与4MiB消息预算内 | 真实长片、高分辨率/其他编码声道；真实设备输出与听感；调用计数不证明原生内存释放/无泄漏 |
| 已有OPFS句柄/音频时间轴/渲染PCM专项接入明确隔离命令，修正旧测试契约 | 独立specialists最终3/3脚本；保留原几何、时间、清理和PCM出点断言，新增真实ASS下载内容核对 | OS picker/持久权限/设备移除；原生/GPU内存、真实磁盘/配额及崩溃 |
| Firefox与WebKit代表应用兼容评估，复用同一流程函数 | Firefox153.0 1/1；冻结WebKit26.4生产1/1（隔离1.60驱动），真实AAC分析/视频/保存刷新/手册；两者均无showOpenFilePicker | 仓库1.62+mac14默认WebKit建页仍失败；开发COEP Worker仍失败；真实Safari/Windows和两浏览器完整52套件未验收 |

相关后端131/131、前端223/223、scripts6/6及静态/构建实际通过。最终专项的3个脚本和独立媒体/平台/生产流程**不计入统一52**；wrapper1例也不把脚本内部检查点换算为额外E2E。失败历史有13次未通过测试运行，保留各轮目录/trace/日志，无自动retry或skip；详细数字、命令、版本、资源预算、清理与人工清单见 [测试手册](testing.md#2026-11-22-辅助入口媒体平台与故障场景) 和 [本轮计划](plans/e2e-aux-media-failures-2026-11-22.md)。本轮没有产品源码修复、接口或支持范围变更。


## 组织member权限增量（2026-11-22）

[成员权限契约](member-permissions.md)索引14项HTTP默认/拒绝/独立授权矩阵、dev/organizer固定能力、配置/成员身份边界、组织隔离、严格key/boolean/CAS、实际迁移、混合文档快照以及PostgreSQL锁等待两个先后顺序。浏览器新增3场覆盖中英文配置冲突、权限变化保留稿件/历史/媒体和独立模板/术语入口，仍通过统一入口选择检查。运行结果/未覆盖边界见 [实施记录](plans/member-permissions.md)。
