# CueRelay

面向字幕组的字幕工具，开发中。目前包含本地视频/ASS 编辑、账号、多组织成员、个人快捷键和项目面板。项目可手动保存字幕快照，本地工作区仍只保留页面内存。

## 环境与启动

Python 3.11.8、Node 26.4.0、npm 11.17.0、PostgreSQL 14+。前端依赖锁在 frontend/package-lock.json，后端在 backend/requirements.txt。正式打轴页已集成本地音频波形与频谱。

先准备自己管理的 PostgreSQL 数据库和用户；数据库用户需具有该数据库的迁移权限，运行 Django 测试还需 CREATEDB。项目不自动配置 Docker、部署或邮件服务。

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

打开 [应用入口](http://127.0.0.1:5173/) 或 [本地工作区](http://127.0.0.1:5173/workspace/local)。Vite 同源 /api、/admin、/static 代理到 Django。新账号由 dev 在 [Django Admin](http://127.0.0.1:8000/admin/) 创建；创建组织时选择一个活动账号作为初始 organizer，二者同事务建立。项目列表右上角的「设置」进入独立设置页，个人设置位于 `/settings` 或带当前组织的 `/organizations/:organizationId/settings/personal`，组织名称和成员管理位于 `/organizations/:organizationId/settings`；组织成员表在 Admin 只读，账号通过停用处理退出。is_staff 不等于 dev，dev 对应 is_superuser。不开放注册或邮件邀请。

一个账号可加入多组织，组织内固定 organizer/member；个人设置跨组织共用。无组织也可操作本地字幕。组织选择只在项目列表，工作区及设置页不保留切换器。切组织仅改变上下文；有字幕、时间输入或本地视频时必须导出、取消或明确放弃。会话失效原位登录，同账号登录后继续原稿；刷新/关闭页面仍会失去内存内容，请及时导出。导出仅包含已应用的时间修改。

## 项目面板

登录后默认进入项目列表，可查看「进行中」「过去项目」，按名称搜索和分页。organizer 管理本组织项目，dev 管理所有组织；member 可查看项目并保存字幕，不能改项目信息或归档/恢复。

「新建项目」在当前列表页打开弹窗，名称、说明、本地视频和空字幕/合法 ASS 在同一表单填写，不设“下一步”。视频完成完整 SHA-256 校验、字幕预检通过后才可确认创建；取消文件选择不会关闭弹窗或清除已填内容。视频不上传。打开后点击「保存项目」持久化已应用字幕，旧版本冲突会保留输入；归档只读。项目名称/打开/只读查看、本地工作区、项目列表、设置及设置分类均默认新开标签页；CueRelay、组织选择和错误页返回入口留在当前页；新建项目是本页弹窗操作。原页字幕、视频和播放状态保留。同页通过前进/回退浏览列表保留当前实例，切换或重新加载先处理本地稿件。

升级运行 `python manage.py migrate` 和前端 `npm ci`，并重启后端。新增 projects.0001_initial 表与 @noble/hashes 2.0.1（MIT），既有音频依赖保留。没有实时协作或自动保存，保存不含尚未应用的时间输入。详细边界与浏览器测试入口见 [项目契约](docs/projects.md)。

## ASS 边界

/api/ass/* 显式公开、无持久副作用，不读取账号或组织，因此会话失效时仍能导出。支持标准 ASS v4+ 样式、中文、文本逗号、\\N/\\n/\\h 和组合粗体/斜体/下划线/删除线标签，保留标准辅助字段、Comment、分号注释与元数据。样式可引用，不提供样式定义编辑。后端唯一负责格式预检、解析与序列化。

未知字段/section/标签、绘图、动画、卡拉 OK、局部字体/颜色/定位、附件、非空 Effect 等整份拒绝可编辑导入。仅 UTF-8（可有 BOM）、1MiB、5000 事件、单行 16384 字符、0–9:59:59.99；Text 须是 Format 最后字段。编辑导出保留受支持语义，不保证空白逐字节一致。当前无字幕预览、字体设置、原件下载或定位测量 UI。详见 [格式模块契约](backend/ass_format/README.md)。

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

视频关闭浏览器原生控制栏，画面下方的独立进度条支持点击、拖动及方向键 / Home / End 定位，保留原有播放按钮和时间显示。定位与音频时间轴同步，取消旧选区试听并保留当前播放 / 暂停状态，不修改字幕。浏览器回归：在 frontend 运行 `npm run test:video-progress`（需 Chrome、FFmpeg 和前端服务，VIDEO_PROGRESS_URL 可指定地址；使用模拟 API，不写开发数据库），见 [验证记录](docs/experiments/video-progress.md)。

## 页面 URL 与导航

组织项目列表：`/organizations/:organizationId/projects`；项目工作区：`/organizations/:organizationId/projects/:projectId/workspace`；本地工作区：`/workspace/local`。项目名称和打开/只读查看可复制链接或原生新开标签页；创建后新增历史记录进入项目，回退回到列表。登录后继续原请求地址，直接访问/刷新加载指定项目的已保存快照，并要求重新选片校验。URL 不保存未保存稿件或视频，新标签页不会复制工作区现场。无组织入口为 `/projects`。

点击左上角 CueRelay 返回 `/` 首页，根地址保持不变，展示当前可访问组织的项目列表；保留已有工作区，返回后可以继续原稿。

开发/生产路径回退、Nginx 示例、隔离数据库播种和 `frontend/browser-tests/navigation.mjs` 的运行方式见 [前端部署与导航验证](docs/frontend-deployment.md)。实际验证结果见 [导航记录](docs/experiments/frontend-navigation.md)。

## 账号名称

账号统一使用 username 登录和显示，没有独立显示名。升级需执行 `python backend/manage.py migrate` 应用 accounts.0003_remove_user_display_name，并同步更新前后端；旧显示名数据会删除，账号 ID、密码、组织关系、项目和快捷键保留。详见 [用户系统升级说明](docs/user-system.md#用户名统一显示升级)。

音频显示偏好已保存到账号：更新本版本需执行 `python backend/manage.py migrate`（accounts.0004），再重启后端与前端。旧快捷键偏好保留；显示设置和快捷键分开保存，不互相覆盖。验证入口 `cd frontend && npm run test:audio-preferences`，一次性测试库准备及结果见 [验证记录](docs/experiments/audio-preferences.md)。
