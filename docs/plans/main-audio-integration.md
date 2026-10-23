# main / audio 集成

日期：2026-10-23。工作分支：`integration`，从 main `2083dc7` 创建；
通过 `git merge --no-ff --no-commit audio` 合并 audio `eaeef0a`。
源工作区起始均干净，main/audio 与各自 origin 引用一致；本次未 fetch。

用户于 2026-10-23 完成人工测试，反馈无问题，并明确批准将 integration 更新到 main。
交付方式：在 integration 完成保留两个父提交的 merge commit，再将 main 快进到同一提交；保留 audio 和 integration 分支，不推送远端。

## 保留的能力和边界

- main：Session、账号安全、多组织权限、个人快捷键、项目初始化/归档/快照/revision 保护。
- audio：本地 Worker 波形/频谱、时间轴/播放头/边界交互、默认首行、提交并下一行、连续删行。
- 媒体仍只在本机；LocalVideoPlayer 校验项目基准后才发布可编辑状态，向时间轴发布同一 File。
- 字幕数据仅由 EditorWorkbench 拥有；音频边界仅修改草稿，保存/导出只包含已提交时间。
- 提交、删除、边界拖动均遵守归档/会话/媒体验证保护；隐藏工作区和账号弹窗暂停快捷键及边界编辑。
- 个人快捷键仍由 shared/timing-shortcuts.json 声明；固定 Ctrl/Cmd+Delete/Backspace 与可配置动作分开，不扩大后端设置白名单。
- 显示模式继续位于顶栏且仅保留页面内存；迁入个人设置/持久化留待独立产品任务。

## 用户决定及落实

1. **B：采用 audio 精简流程。** G/Enter 或个人覆盖键提交并选择下一行，末行续一条 2 秒空行；移除旧的单独应用、创建行、循环、采集/微调按钮。边界方向键微调与单次试听保留；底层公共区间播放契约保留。
2. **A：完整保护，忽略未修改默认首行。** `hasProtectedContent` 共用于 beforeunload 与 WorkbenchHandle.hasContent。视频、项目、成功导入、真实编辑、忙碌和待确认导入均受保护；仅自动首行不提示。打开项目不隐式补行或改变已保存快照。

## 自主解决的冲突

Git 文本冲突共 8 个文件：README、架构入口、package.json/lock、LocalVideoPlayer、playback、EditorWorkbench、timing-shortcuts。

- 依赖合并为并集，同时保留 @noble/hashes 与 fft.js，并用 npm ci --offline 验证锁文件。
- LocalVideoPlayer 同时保留 SHA-256/初始媒体/校验状态接口和 onFile；校验失败的文件不进入音频分析。
- 焦点/IME 过滤与精确个人修饰键覆盖整合，保留 slider 的 Enter/Space 和固定删除组合键。
- 保留项目保存/revision、只读、重载、header、visible 和 WorkbenchHandle 接口，组合音频 UI。
- 语义修复：新增 commitAndAdvance/deleteSelectedCue 自身及快捷键分派补 canEdit；边界回调补 canEdit、visible、shortcutsPaused、busy、pendingImport。
- 同步默认动作标签，避免设置仍显示“应用时间”却实际提交并续行。
- 更新音频浏览器测试的真实登录/本地工作区入口；Tab 测试不再假设 Waveform 是全页首个控件。
- 账号浏览器测试使用已确认的新工作流，继续验证续行后原稿保留、会话和切换保护。

## 实际执行结果

环境：Python 3.11.8、PostgreSQL 16.2、Node 26.4.0、Chrome 147.0.7727.101。
独立 PostgreSQL 集群 `/private/tmp/cuerelay-integration-pg`，本机 55435。
浏览器库 cuerelay_projects_browser / cuerelay_browser 仅在此新集群创建和播种；未读取业务 .env、迁移业务库或修改真实账号。

| 检查 | 结果 |
| --- | --- |
| npm ci --offline | 通过，锁文件同时安装两个分支依赖 |
| npm run typecheck | 通过 |
| npm run test -- --run | 17 文件、169 测试通过（产品决策落实后复查） |
| npm run build | 通过，哈希 Worker 与音频 Worker 均生成 |
| Django check | 0 issues |
| manage.py test accounts ass_format http_api organizations projects --noinput | 59 测试通过，真实 PostgreSQL，8.865 秒 |
| manage.py makemigrations --check --dry-run | No changes detected |
| browser-tests/projects.mjs | 8 组流程通过，页面错误 0 |
| browser-tests/user-system.mjs | 9 组流程通过，页面错误 0 |
| browser-tests/audio-timeline.mjs（Vite 开发） | 全部通过，页面错误/媒体上传 0 |
| browser-tests/audio-timeline.mjs（生产包预览） | 全部通过，页面错误/媒体上传 0 |
| browser-tests/audio-lifecycle.mjs | 换片/卸载/清除 Worker 回收通过；无音轨不阻断播放与编辑；页面错误 0 |
| browser-tests/main-audio-integration.mjs | 4 组跨模块流程通过，页面错误 0 |
| 相对静态 import 图 + Python AST import 图 | 48 前端 / 21 后端生产模块无循环；media/project-data 无向 UI 反向依赖，accounts/ass_format 无向上依赖 |
| git diff --check | 通过 |

仓库没有 lint 脚本或独立 linter 配置，未声称执行 lint。静态图覆盖显式仓库内 import，不等价于运行期动态依赖证明。

首次账号浏览器回归失败因旧测试假定提交后仍停留原行；更新为续行断言并检查原行文本后通过。新增集成回归首次构造了带 name 的错误媒体 DTO，被后端白名单正确拒绝；测试改为现有三字段契约后通过。没有删除或绕过测试。

## 跨模块回归与复现

测试脚本在 frontend/browser-tests，沿用 Playwright/Chrome + FFmpeg。先按 docs/projects.md / docs/user-system.md 在**一次性数据库**迁移并播种；环境必须为 DEBUG，测试账号不可用于业务库。

- 项目和新增集成：仓库根运行 `node frontend/browser-tests/projects.mjs`、`node frontend/browser-tests/main-audio-integration.mjs`，设置 BROWSER_TEST_PASSWORD、PROJECTS_URL。
- 账号：仓库根运行 `node frontend/browser-tests/user-system.mjs`，设置 BROWSER_TEST_PASSWORD、USER_SYSTEM_URL。
- 音频：frontend 目录运行 `npm run test:audio-timeline` / `npm run test:audio-lifecycle`，设置 BROWSER_TEST_PASSWORD、AUDIO_TIMELINE_URL，可选 BROWSER_TEST_USERNAME（默认 project-empty）。后端应指向一次性项目库，前端 CUERELAY_API_TARGET 指向该后端。
- 生产包：npm run build 后以相同 CUERELAY_API_TARGET 启动 preview，在其 URL 再运行时间轴测试；生命周期实验页只用于开发服务器。

新增集成回归覆盖：默认行/仅视频的离页与 App 切换规则；未验证片源提交/删除拒绝；同大小错误摘要拒绝；实际音频分析；草稿与保存分离；个人覆盖与弹窗保护；隐藏时快捷键暂停且媒体/模式/草稿保留；归档后的边界/提交/删除拒绝与导出。

浏览器截图已查看：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-integration-a28Md9/integrated.png`。合成媒体及测试密钥只在临时目录，不提交仓库。

## 剩余风险与交付

- 用户已完成人工测试并反馈无问题；本次自动回归及用户反馈不代表 Firefox/Safari、大型真实片源或生产部署已完成专项验收。
- 模式偏好不持久化；本地草稿/媒体仍依赖页面内存。保存只包含已提交字幕，和原项目契约一致。
- 用户已批准合并提交和本地 main 同步；push 仍需明确授权。
