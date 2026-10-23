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

.env 被 Git 忽略，不提交真实密钥。默认生产模式使用 Secure Cookie；本机 HTTP 必须在 .env 设置 DJANGO_DEBUG=1。Session 存数据库，7 天，HttpOnly Cookie；CSRF 可信开发 Origin 见示例。环境文件由 shell 显式加载，不隐式读取。部署时使用 HTTPS、DEBUG=0，配置实际 ALLOWED_HOSTS 和必要的可信 Origin；生产服务器与静态文件部署不在本任务范围。

AUTH_USER_MODEL 已在首次迁移前设置。仓库此前无数据库配置/业务迁移；若自行已有数据库或 auth_user 数据，不要重置或直接切换用户表，先单独制定兼容数据迁移。

账号安全：新密码为 15–1024 字符，既有短密码仍可登录；API/Admin 共用 PostgreSQL 账号失败限制（5 次/15 分钟，固定冷却 5 分钟），返回 429 和 Retry-After。升级需应用 accounts.0002_loginattempt 迁移并重启全部后端；每日运行 `python manage.py clear_login_attempts` 清理旧状态。无需新增依赖。单 IP 限速留待 nginx；生产环境未验收。入口、参数、库选型与部署操作见 [账号安全](docs/account-security.md)。

另一个终端：

```sh
cd frontend
npm ci
npm run dev
```

打开 [本地工作区](http://127.0.0.1:5173/)。Vite 同源 /api 代理到 Django。新账号由 dev 在 [Django Admin](http://127.0.0.1:8000/admin/) 创建；创建组织时选择一个活动账号作为初始 organizer，二者同事务建立。成员管理在工作区顶栏；组织成员表在 Admin 只读，账号通过停用处理退出。is_staff 不等于 dev，dev 对应 is_superuser。不开放注册或邮件邀请。

一个账号可加入多组织，组织内固定 organizer/member；个人设置跨组织共用。无组织也可操作本地字幕。切组织仅改变上下文；有字幕、时间输入或本地视频时必须导出、取消或明确放弃。会话失效原位登录，同账号登录后继续原稿；刷新/关闭页面仍会失去内存内容，请及时导出。导出仅包含已应用的时间修改。

## 项目面板

登录后默认进入项目列表，可查看「进行中」「过去项目」，按名称搜索和分页。organizer 管理本组织项目，dev 管理所有组织；member 可查看项目并保存字幕，不能改项目信息或归档/恢复。

新建项目填写名称/说明，选择本地视频完成完整 SHA-256 校验，再选择空字幕或合法 ASS，最终确认后原子创建。视频不上传。打开后点击「保存项目」持久化已应用字幕，旧版本冲突会保留输入；归档只读。浏览列表保留当前工作区，切换或重新加载先处理本地稿件。

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

本地音频分段提取的阶段 A 验证入口与大文件实测限制见 [音频提取记录](docs/experiments/local-audio.md)。打轴页默认 Spectrum，顶栏可切换 Waveform / Spectrum；普通滚轮平移、Shift+滚轮缩放，也可拖动平移、点击定位和拖动入出点；拖动只改时间草稿，按 G / Enter（或个人覆盖键位）提交并进入下一行，末行自动续一条 2 秒空行。交互、Worker 缓存及浏览器回归见 [音频时间轴记录](docs/experiments/audio-timeline.md)。

架构入口：[docs/architecture.md](docs/architecture.md)。本次 main/audio 集成状态、用户决定及验证见 [集成记录](docs/plans/main-audio-integration.md)。
