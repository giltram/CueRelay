# 项目参考字幕对照

2026-11-22。授权范围：本地 UTF-8 SRT、创建可选上传、项目设置补传/替换/清除、项目工作区只读时间对照。无链接下载、本地工作区、自动填译文、第二编辑轨或实时协作。

## 契约与执行

1. 复用 srt_format 块/正文扫描，公开毫秒精度纯文本参考解析；不经 ASS 量化。相同块、标签/实体、1MiB/5000块/16384字符预算；纯文本可保留 ASS 无法表达的字面括号和反斜线，React 文本节点安全展示。
2. projects 拥有 nullable reference_cues 与独立 reference_version（初始1），迁移旧项目为 null。创建随媒体/文档原子写入；设置 PUT 独立版本 CAS，只更新两列，不 touch 正文 revision/更新时间。锁序 User → Organization → Project，复用活动身份、组织归属、归档、Session/CSRF。
3. 复用已有可配置能力：创建时只需 create_project；后续参考管理属 edit_project。dev/organizer 配置 member 能力，并非唯一上传者。无需新增能力默认值。
4. 项目 detail 只读返回参考快照。现有 app-workspace 有序读取（进入/返回、focus/visibility/30秒）仅接纳参考及状态，不接纳远端正文/revision。项目/身份生命周期沿用原请求隔离，拒绝读取后隐藏参考。
5. 独立 reference-subtitles 模块拥有纯时间匹配、媒体时钟订阅、固定高度可收起文本面板。工作区显式传选中正式区间/视频/试听真实时钟；不写正文、历史、QC或预览。编辑暂停使用选中区间，未选行使用当前位置；播放使用视频时间，试听优先真实音频时间，停止回编辑区间。
6. 参考按 start/end/源序稳定排序；区间用半开重叠，零时长视点；多条全部匹配，取匹配组前后紧邻各一条。无匹配明确提示，前后文选最近已结束/即将开始项，不当作匹配。空正文保留并明确显示。
7. 复用现有创建/设置 file picker，失败保留旧数据/输入；工作区无管理流程。参考交互隔离快捷键、可原生选择复制，不自动抢正文焦点。短窗口允许编辑区滚动，不改变视频布局/生命周期。

## 验证计划

纯解析/匹配/时钟策略测试；真实 PostgreSQL 创建有无参考、持久化、权限配置撤回、组织隔离、归档、CAS竞争、失败原子性、正文独立性及迁移；类型、i18n、构建、单元；真实 Chromium 创建/设置/工作区、播放/试听/复制/折叠、窄短布局及草稿/媒体/撤销保持。使用隔离数据库，不连接开发/生产库。不提交或推送。

## 执行记录

- 初始 git status/diff 均为空；当前 ASS 静态兼容已经在代码中，保留。
- 已读架构、projects/srt/organizations/project-ui/project-data/app-workspace/workspace-ui/audio README 与 no-slop-ui。
- 已实现模型/迁移、共享扫描器、创建/PUT、独立CAS、配置权限标签、创建/设置入口、只读对照与既有有序观察刷新；架构与双语手册已同步。
- 22项定向后端通过：`srt_format projects.test_reference projects.test_reference_migration`；隔离目录 `/private/tmp/cuerelay-reference-gsoyph0g`。扩展后端 `projects organizations http_api srt_format ass_format` 222项运行，221通过、1项真实Nginx代理测试因未配置NGINX_BINARY而跳过；目录 `/private/tmp/cuerelay-reference-g5w279t8`。两次测试库销毁、pg_ctl stop=0。
- 初版553项前端单元、类型、i18n、生产构建通过；Vite提示现有大bundle，不作为失败。最终复验554项前端单元全部通过（67文件），`npm --prefix frontend run test -- --run --exclude 'platform-tests/**'`；i18n/类型/生产build均通过，日志 `/private/tmp/cuerelay-reference-final-{unit,build}.log`。
- 浏览器首轮2场：创建/英文短窗口通过，设置场景在已验证播放/试听/复制/历史后因测试写错现有separator名称超时；保留失败证据 `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-0257ki0r`。第二轮3场：创建及真实撤权/旧成功迟到/恢复/本地路由隔离通过；设置场景因测试在清除请求提交完成前触发聚焦读取而失败，已改为等待真实PUT成功后重新聚焦，未增加产品推送或固定sleep。证据 `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-9jp_i6ix`。
- 已目视检查英文1100×620及中文700×700截图。短窗口编辑区内部滚动，窄屏沿用sticky视频；未改视频尺寸/节点生命周期。
- AST/静态导入图扫描：后端/前端产品模块均未发现环；Django check=0、makemigrations --check --dry-run无变更（沙箱不允许连接缺省测试端口，migration history检查有警告；实际迁移及历史旧项目迁移已在上述一次性数据库执行）。
- 没有阻塞性未决产品问题。最终验证已完成。
- 三场新增浏览器首次全通过目录 `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-ebl3ggpb`（21.838秒）；新增相同参考版本保留对象引用，避免状态观察重置原生文本选择/手动滚动后，最终六场全部通过：三场参考 + 原创建空项目、SRT项目流、成员项目设置/样式能力。目录 `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-drzme1l9`，Django 43.792秒，逐场日志/trace/截图在 scenarios 下；metadata exit=0、stop=0、测试库销毁、source保持一致；并行最终Vitest只改变默认缓存的 `vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`，metadata如实为default_cache_unchanged=false；浏览器仍使用逐场新建的独立Vite缓存。
- 参考场景实际验证：未上传无占位、旧项目补传、替换失败保留旧参考/元数据草稿、更换与清除、原始毫秒、HTML实体安全显示、原生复制、折叠保留正文焦点、视频播放、真实独立音频时钟/视频保持、暂停恢复区间、长前文自动揭示当前片段及内部滚动、同版本观察保留手动滚动、拖动布局/1100×620/700×700、正文草稿/选择/撤销/保存和原video/ASS canvas身份及视频几何保持；真实成员移除后旧成功响应不可回显参考，恢复访问/转本地工作区隔离。
- `scripts/test_regression_selection.py`最终通过：当前60个统一浏览器入口与实际Playwright发现一一对应（只作发现校验，不冒称60场均已运行）。静态导入图再次无环、git diff --check无问题。
- 未跑全部60场/Firefox/WebKit/真实长片或OS原生选择器；六场为真实Chromium与合成8秒媒体，不能代表真实片源/设备听感验收。Nginx专项仍跳过。无新架构风险需额外范围内重构；未提交、未推送，未连接开发/生产数据库。

## 部署与复现

先备份并运行 `python backend/manage.py migrate`，应用projects.0005_project_reference，再启动同版前后端；旧项目自动为无参考，不重写ASS/权限配置。没有生产/开发库迁移在本任务中被执行。迁移测试真实撤销/重新应用0005并验证原字段及旧项目上传。

后端标准入口：

```sh
.venv/bin/python backend/manage.py test projects organizations http_api srt_format ass_format --settings=application.test_settings --noinput -v 2
```

浏览器标准入口（必须使用Django创建的隔离测试库）：

```sh
.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_reference_settings browser_tests.regression.WorkspaceRegressionTests.test_reference_creation browser_tests.regression.WorkspaceRegressionTests.test_reference_isolation --settings=application.test_settings --noinput -v 2
```

本轮以 `/private/tmp/cuerelay-reference-run.py` 和 `/private/tmp/cuerelay-reference-browser.py` 驱动新建/销毁的独立PostgreSQL；浏览器驱动使用仓库run_isolated_regression及envFile:false设施，仅替换目标选择。最初沙箱拒绝localhost bind后，经运行工具授权进行隔离验证，未放宽产品CSRF/鉴权或连接既有数据库。
