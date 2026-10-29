# 本机开发数据库

2026-10-29：旧 `/private/tmp/cuerelay-user-pg` 集群缺少关键文件，经用户确认放弃旧数据，新建持久化本机数据库。旧目录未覆盖。数据库结构仍以各模块的 Django models 和 migrations 为准。

本机当前配置：

- 数据目录：仓库根目录下 `.local-dev/postgres-data`。
- PostgreSQL 运行时：`.local-dev/postgres-runtime/pgserver/pginstall`，由 `pgserver==0.1.4` 提供 PostgreSQL 16.2，仅用于本机开发，不是应用依赖。
- 监听：`127.0.0.1:55432`；数据库和应用角色均为 `cuerelay`。应用角色拥有数据库及 CREATEDB 权限，不是集群超级用户。
- Django 连接配置：根目录 `.env`，由 shell 显式加载。
- 新管理员：`admin`，初始随机密码位于 `.local-dev/admin-credentials.txt`。
- 集群管理账号：`cuerelay_cluster`，密码位于 `.local-dev/postgres-owner.password`。

`.local-dev/` 和 `.env` 均被 Git 忽略；数据库、运行时和密码不要放入 `/tmp` 或 `/private/tmp`，也不要删除 `.local-dev/` 来清理构建产物。Git 保存表结构定义，不备份实际数据。

## 启停

以下命令均从仓库根目录执行。数据库已初始化，日常启动无需重新安装运行时或运行 initdb。

```sh
.local-dev/postgres-runtime/pgserver/pginstall/bin/pg_ctl \
  -D .local-dev/postgres-data -l .local-dev/postgres.log \
  -o "-h 127.0.0.1 -p 55432 -k '$PWD/.local-dev'" -w start

set -a
source .env
set +a
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py runserver 127.0.0.1:8000
```

另一个终端运行 `cd frontend && npm run dev`。先停止后端，再停止数据库：

```sh
.local-dev/postgres-runtime/pgserver/pginstall/bin/pg_ctl \
  -D .local-dev/postgres-data -m fast -w stop
```

当前没有设置开机自启动。数据库日志为 `.local-dev/postgres.log`。
