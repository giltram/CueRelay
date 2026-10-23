# CueRelay

面向字幕组的字幕工具，开发中。目前包含本地视频/ASS 编辑、账号、多组织成员和个人快捷键；字幕仍在页面内存中，没有云端项目保存。

## 环境与启动

Python 3.11.8、Node 26.4.0、npm 11.17.0、PostgreSQL 14+。前端依赖锁在 frontend/package-lock.json，后端在 backend/requirements.txt。音频实验保持独立，尚未接入正式打轴页。

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

另一个终端：

```sh
cd frontend
npm ci
npm run dev
```

打开 [本地工作区](http://127.0.0.1:5173/)。Vite 同源 /api 代理到 Django。新账号由 dev 在 [Django Admin](http://127.0.0.1:8000/admin/) 创建；创建组织时选择一个活动账号作为初始 organizer，二者同事务建立。成员管理在工作区顶栏；组织成员表在 Admin 只读，账号通过停用处理退出。is_staff 不等于 dev，dev 对应 is_superuser。不开放注册或邮件邀请。

一个账号可加入多组织，组织内固定 organizer/member；个人设置跨组织共用。无组织也可操作本地字幕。切组织仅改变上下文；有字幕、时间输入或本地视频时必须导出、取消或明确放弃。会话失效原位登录，同账号登录后继续原稿；刷新/关闭页面仍会失去内存内容，请及时导出。导出仅包含已应用的时间修改。

## ASS 边界

/api/ass/* 显式公开、无持久副作用，不读取账号或组织，因此会话失效时仍能导出。支持标准 ASS v4+ 样式、中文、文本逗号、\\N/\\n/\\h 和组合粗体/斜体/下划线/删除线标签，保留标准辅助字段、Comment、分号注释与元数据。样式可引用，不提供样式定义编辑。后端唯一负责格式预检、解析与序列化。

未知字段/section/标签、绘图、动画、卡拉 OK、局部字体/颜色/定位、附件、非空 Effect 等整份拒绝可编辑导入。仅 UTF-8（可有 BOM）、1MiB、5000 事件、单行 16384 字符、0–9:59:59.99；Text 须是 Format 最后字段。编辑导出保留受支持语义，不保证空白逐字节一致。当前无字幕预览、字体设置、原件下载或定位测量 UI。详见 [格式模块契约](backend/ass_format/README.md)。

## 验证

加载 .env 后：

```sh
source .venv/bin/activate
cd backend
python manage.py check
python manage.py test ass_format http_api organizations
```

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run build
```

用户系统可执行 Chrome 测试、专用测试数据库播种步骤见 [用户系统](docs/user-system.md)，实际执行结果及限制见 [验收记录](docs/experiments/user-system.md)。合成浏览器验证不代表真实片源或熟练成员试用通过。

架构入口：[docs/architecture.md](docs/architecture.md)。音频阶段 A 的独立开发验证、测试和大文件限制见 [音频实验记录](docs/experiments/local-audio.md)；本任务未改变音频处理逻辑或依赖。历史媒体/ASS 实验见 [实验记录](docs/experiments/media-ass.md)。
