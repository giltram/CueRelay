# CueRelay

面向字幕组的字幕工具，开发中。目前包含本地视频/ASS 编辑、账号、多组织成员、个人快捷键和项目面板。项目可手动保存字幕快照，本地工作区仍只保留页面内存。

## 环境与启动

Python 3.11.8、Node 26.4.0、npm 11.17.0、PostgreSQL 14+。前端依赖锁在 frontend/package-lock.json，后端在 backend/requirements.txt。正式打轴页已集成本地音频波形与频谱。

先准备自己管理的 PostgreSQL 数据库和用户；数据库用户需具有该数据库的迁移权限，运行 Django 测试还需 CREATEDB。项目不自动配置 Docker、部署或邮件服务。

本机已配置的持久开发数据库及启停命令见 [本机开发数据库](docs/local-development.md)。

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp .env.example .env
# 编辑 .env，填入私有随机 DJANGO_SECRET_KEY 和 PostgreSQL 连接信息。
# 随机密钥可用：python -c 'import secrets; print(secrets.token_urlsafe(50))'
set -a
source .env
set +a
cd backend
python manage.py check
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 127.0.0.1:8000
```

.env 被 Git 忽略，不提交真实密钥。默认生产模式使用 Secure Cookie；本机 HTTP 必须在 .env 设置 DJANGO_DEBUG=1。Session 存数据库，7 天，HttpOnly Cookie；CSRF 可信开发 Origin 见示例。环境文件由 shell 显式加载，不隐式读取。部署时使用 HTTPS、DEBUG=0，配置实际 ALLOWED_HOSTS 和必要的可信 Origin；生产路径回退与 API/Admin 隔离示例见 [前端部署](docs/frontend-deployment.md)，实际生产发布尚需按部署环境验收。

AUTH_USER_MODEL 已在首次迁移前设置。仓库此前无数据库配置/业务迁移；若自行已有数据库或 auth_user 数据，不要重置或直接切换用户表，先单独制定兼容数据迁移。

账号安全：新密码为 15–1024 字符，既有短密码仍可登录；API/Admin 共用 PostgreSQL 账号失败限制（5 次/15 分钟，固定冷却 5 分钟），返回 429 和 Retry-After。升级需应用 accounts.0002_loginattempt 迁移并重启全部后端；每日运行 `python manage.py clear_login_attempts` 清理旧状态。无需新增依赖。单 IP 限速留待 nginx；生产环境未验收。入口、参数、库选型与部署操作见 [账号安全](docs/account-security.md)。

另一个终端：

```sh
cd frontend
npm ci
npm run dev
```

打开 [应用入口](http://127.0.0.1:5173/) 或 [本地工作区](http://127.0.0.1:5173/workspace/local)。Vite 同源 /api、/admin、/static 代理到 Django。新账号由 dev 在 [Django Admin](http://127.0.0.1:8000/admin/) 创建；创建组织时选择一个活动账号作为初始 organizer，二者同事务建立。项目列表右上角的「设置」进入独立设置页，个人设置位于 `/settings` 或带当前组织的 `/organizations/:organizationId/settings/personal`，组织名称和成员管理位于 `/organizations/:organizationId/settings/organization`；组织成员表在 Admin 只读，账号通过停用处理退出。is_staff 不等于 dev，dev 对应 is_superuser。不开放注册或邮件邀请。

一个账号可加入多组织，组织内固定 organizer/member；个人设置跨组织共用。无组织也可操作本地字幕。组织选择只在项目列表，工作区及设置页不保留切换器。切组织仅改变上下文；有字幕、时间输入或本地视频时必须导出、取消或明确放弃。会话失效原位登录，同账号登录后继续原稿；刷新/关闭页面仍会失去内存内容，请及时导出。导出仅包含已应用的时间修改。

## 项目面板

登录后默认进入项目列表，可查看「进行中」「过去项目」，按名称搜索和分页。organizer 管理本组织项目，dev 管理所有组织；member 可查看项目并保存字幕，不能改项目信息或归档/恢复。项目列表操作直接展示「项目设置」和「归档项目」；项目设置在独立页面编辑名称与说明（`/organizations/:organizationId/projects/:projectId/settings`），点击项目名称进入工作区。

「新建项目」在当前列表页打开弹窗，名称、说明、本地视频和空字幕/合法 ASS 在同一表单填写，不设“下一步”。视频完成完整 SHA-256 校验、字幕预检通过后才可确认创建；取消文件选择不会关闭弹窗或清除已填内容。视频不上传。打开后点击「保存项目」持久化已应用字幕，旧版本冲突会保留输入；归档只读。项目名称、项目设置、本地工作区、项目列表及设置入口默认新开标签页；设置页内个人/组织分类在当前标签页切换；CueRelay、组织选择和错误页返回入口留在当前页；新建项目是本页弹窗操作。原页字幕、视频和播放状态保留。同页通过前进/回退浏览列表保留当前实例，切换或重新加载先处理本地稿件。

升级运行 `python manage.py migrate` 和前端 `npm ci`，并重启后端。新增 projects.0001_initial 表与 @noble/hashes 2.0.1（MIT），既有音频依赖保留。没有实时协作或自动保存，保存不含尚未应用的时间输入。详细边界与浏览器测试入口见 [项目契约](docs/projects.md)。

## ASS 边界

/api/ass/* 显式公开、无持久副作用，不读取账号或组织，因此会话失效时仍能导出。支持标准 ASS v4+ 样式、中文、文本逗号、\\N/\\n/\\h 和组合粗体/斜体/下划线/删除线标签，保留标准辅助字段、Comment、分号注释与元数据。样式可通过管理面板创建、改名、复制、批量修改与分配；使用稳定 ID 引用。后端唯一负责格式预检、解析与序列化。

未知字段/section/标签、绘图、动画、卡拉 OK、局部字体/颜色/定位、附件、非空 Effect 等整份拒绝可编辑导入。仅 UTF-8（可有 BOM）、1MiB、5000 事件、单行 16384 字符、0–9:59:59.99；Text 须是 Format 最后字段。编辑导出保留受支持语义，不保证空白逐字节一致。当前提供实时 ASS 视频预览及显示/隐藏开关，复用相同序列化器；有效时间草稿可提前预览，保存和导出仍使用已应用时间。内置同源 Noto Sans SC fallback，不查询系统/在线字体；没有字体管理、原件下载或定位测量 UI。详见 [格式模块契约](backend/ass_format/README.md)。

预览架构与兼容边界见 [ass-preview](frontend/src/ass-preview/README.md)，真实浏览器执行结果及复现命令见 [ASS 预览验证](docs/experiments/ass-preview.md)。

## 验证

加载 .env 后：

```sh
source .venv/bin/activate
cd backend
python manage.py check
python manage.py test accounts ass_format http_api organizations projects
```

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run build
```

用户系统可执行 Chrome 测试、专用测试数据库播种步骤见 [用户系统](docs/user-system.md)，实际执行结果及限制见 [验收记录](docs/experiments/user-system.md)。合成浏览器验证不代表真实片源或熟练成员试用通过。

字幕表格按「行号、入、出、CPS、style、字幕文本」显示，CPS 为当前文字与已应用时长的每秒字符数；空文本显示斜体 `（empty）`。入/出默认各 100px、CPS 44px、style 88px，文字占剩余宽度；拖动这四列表头右边界调整宽度，双击恢复默认，聚焦边界后可用左右键微调（Shift 加大步长，Home/End 到最小/最大）。列宽仅保留在当前工作区，刷新恢复默认；窄屏在表格内横向滚动。在 frontend 运行 `npm run test:cue-table` 可验证列顺序、CPS、拖拽/键盘调宽、状态保留和视频提示（需 Chrome、FFmpeg 与 5173 开发服务；接口使用页面内测试夹具，不访问开发数据库），见 [验证记录](docs/experiments/cue-table.md)。

本地音频分段提取的阶段 A 验证入口与大文件实测限制见 [音频提取记录](docs/experiments/local-audio.md)。打轴页默认 Spectrum，在个人设置的「音频显示」选择并保存 Waveform / Spectrum；回到原工作区标签页时生效，保留视频、字幕、时间草稿和视窗。普通滚轮平移、Shift+滚轮缩放，也可拖动平移、点击定位和拖动入出点；拖动只改时间草稿，按 G / Enter（或个人覆盖键位）提交并进入下一行，末行自动续一条 2 秒空行。交互、Worker 缓存及浏览器回归见 [音频时间轴记录](docs/experiments/audio-timeline.md)。

架构入口：[docs/architecture.md](docs/architecture.md)。本次 main/audio 集成状态、用户决定及验证见 [集成记录](docs/plans/main-audio-integration.md)。

在打轴区域按 **Tab** 聚焦当前字幕文本框，再按 **Tab** 返回打轴，恢复 Q/W/G 等快捷键；进入文本框保留原光标或选区。这个固定快捷键只在工作区 main、音频画布及边界滑块与字幕文本框之间生效。时间输入、按钮、其他控件和 Shift+Tab 保持原导航；输入法组词、弹窗、导入处理、只读、未选中行及全屏期间不接管。切换不提交时间、不保存或切换行，无需配置或数据库迁移。验证：`cd frontend && npm run test:subtitle-focus`（Chrome、FFmpeg 和 5173 前端服务；`SUBTITLE_FOCUS_URL` 可指定地址，API 使用隔离夹具，不写开发数据库），详见 [验证记录](docs/experiments/subtitle-focus.md)。

视频关闭浏览器原生控制栏，画面下方的独立进度条支持点击、拖动及方向键 / Home / End 定位，保留原有播放按钮和时间显示。定位与音频时间轴同步，取消旧选区试听并保留当前播放 / 暂停状态，不修改字幕。浏览器回归：在 frontend 运行 `npm run test:video-progress`（需 Chrome、FFmpeg 和前端服务，VIDEO_PROGRESS_URL 可指定地址；使用模拟 API，不写开发数据库），见 [验证记录](docs/experiments/video-progress.md)。

## 页面 URL 与导航

组织项目列表：`/organizations/:organizationId/projects`；项目工作区：`/organizations/:organizationId/projects/:projectId/workspace`；本地工作区：`/workspace/local`。项目名称和项目设置可复制链接或原生新开标签页；创建后新增历史记录进入项目，回退回到列表。登录后继续原请求地址，直接访问/刷新加载指定项目的已保存快照，并要求重新选片校验。URL 不保存未保存稿件或视频，新标签页不会复制工作区现场。无组织入口为 `/projects`。

点击左上角 CueRelay 返回 `/` 首页，根地址保持不变，展示当前可访问组织的项目列表；保留已有工作区，返回后可以继续原稿。

开发/生产路径回退、Nginx 示例、隔离数据库播种和 `frontend/browser-tests/navigation.mjs` 的运行方式见 [前端部署与导航验证](docs/frontend-deployment.md)。实际验证结果见 [导航记录](docs/experiments/frontend-navigation.md)。

## 账号名称

账号统一使用 username 登录和显示，没有独立显示名。升级需执行 `python backend/manage.py migrate` 应用 accounts.0003_remove_user_display_name，并同步更新前后端；旧显示名数据会删除，账号 ID、密码、组织关系、项目和快捷键保留。详见 [用户系统升级说明](docs/user-system.md#用户名统一显示升级)。

音频显示偏好已保存到账号：更新本版本需执行 `python backend/manage.py migrate`（accounts.0004），再重启后端与前端。旧快捷键偏好保留；显示设置和快捷键分开保存，不互相覆盖。验证入口 `cd frontend && npm run test:audio-preferences`，一次性测试库准备及结果见 [验证记录](docs/experiments/audio-preferences.md)。

项目设置界面回归：启动前端后，在 frontend 执行 `npm run test:project-settings`（需 Chrome，`PROJECT_SETTINGS_URL` 可指定地址）；使用 HTTP 测试夹具验证独立页面、名称/说明保存、版本冲突、归档/权限和窄屏布局，不访问开发数据库。

通用编辑操作：个人设置增加默认开启的「鼠标点击设置字幕边界」，关闭后频谱背景左击只移动播放头。四个播放头裁剪/拆分动作默认均无绑定，可在原快捷键列表配置。项目拆分由后端原子保存完整快照并检查 revision；本地拆分仍需导出。文本拆分首版仅支持普通文本，含 ASS 标签或转义明确拒绝。按已确认范围，尚无字幕编辑锁、审核、修改历史或实时推送。升级需应用 accounts.0005 迁移并同步重启前后端。具体规则、保存影响与测试入口见 [编辑操作](docs/editing-operations.md)。

## 组织样式库与项目样式管理

组织设置内维护样式模板；新建项目可选择组织模板和 ASS PlayRes。「项目设置 → 项目样式 → 管理项目样式」支持搜索、复制人物颜色样式、仅更新勾选属性的批量编辑、使用数、字幕批量分配与 ASS 效果预览。导入采用独立快照，模板后续变更不会影响项目。设置页无需选择视频，样式操作使用服务端已保存的字幕快照并立即保存，不提交工作区中未保存的字幕或时间输入。已打开的工作区需显式重新加载项目才能采用新样式，旧版本保存仍会冲突。本地工作区保留「管理样式」，需导出保存。

升级包含 organizations.0002 / projects.0002。先在旧页面导出需要的稿件，备份数据库并暂停写入，再运行 `python backend/manage.py migrate`、同步部署前后端并刷新客户端。旧快照一次迁移为稳定样式 UUID；不支持无损自动降级。尚无多人实时推送、完整修改历史或审核系统，其他成员需显式重新加载。

从 v1 升级前先运行只读 `python backend/manage.py check_style_migration`，列出全部不兼容项目；停止写入后重查通过才迁移。旧版本接受的非规范/重复 PlayRes 和超长样式名保持显式拒绝，处理流程见 [升级与恢复](docs/style-management.md#升级与恢复)。审计修复与测试结果见 [2026-10-26 修复记录](docs/plans/repository-audit-fixes-2026-10-26.md)。

分辨率适配仅开放已验证的同宽高比等比规则；其他情况原样复制后人工调整。字体使用现有 Noto Sans SC fallback，不自动上传或获取字体。测试入口：`cd frontend && npm run test:style-management`；契约、迁移、限制和后端测试见 [样式管理](docs/style-management.md)。

视频右上角为小尺寸全屏/退出全屏图标（16px 图标、28px 点击区域）。进入全屏保留当前位置及播放/暂停状态并取消字幕区间停止限制；全屏空格从当前位置播放/暂停，退出后恢复原有快捷键含义，不自动跳回字幕区间。验证：`cd frontend && npm run test:fullscreen-playback`（真实 Chrome/FFmpeg、前端开发服务，API 为隔离夹具，不写开发数据库）。

2026-10-25 全屏播放验证：前端 269 项单测、类型检查及构建通过；真实 Chrome 全屏播放/图标/长按空格/退出后快捷键恢复，以及既有视频进度和 ASS 预览浏览器回归通过。全屏退出事件在无界面 Chrome 中经 Fullscreen API 验证，不把模拟 Escape 当成浏览器原生命令。

工作区支持 **Cmd/Ctrl+Z 撤销、Cmd/Ctrl+Shift+Z 重做**（可在个人设置覆盖）。一次边界拖动/方向键长按、提交并下一条/自动新增、删除均按原子步骤恢复文档、选择和时间草稿，最多保留本实例内 100 步。文本/样式同样接入；输入框保留原生撤销，实际原生撤销/重做建立新的工作区历史基线。保存不清空历史，也不回退服务端 revision；拆分撤销只改变本地内容，下次手动保存才写服务器。导入成功、显式重载和替换实例清空；隐藏恢复保留。详情见 [工作区历史](frontend/src/workspace-ui/README.md)。验证：`cd frontend && npm run test:workspace-history`（Chrome、FFmpeg、Vite 默认 5189，HISTORY_URL 可覆盖；隔离 HTTP fixture + 真实 ASS 纯转换，不写开发数据库）。
