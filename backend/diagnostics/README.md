# HTTP 诊断与日志

`application.settings` 将 RequestDiagnosticsMiddleware 安装为最外层，覆盖安全中间件、CSRF、认证、业务冲突和异常。此模块不依赖账号/项目 ORM；不改变认证、授权、revision 或事务。Django 的正常 403/404 等异常保留既有语义，真正未处理异常返回固定 500 JSON，即使 DEBUG 也不向 API 普通用户暴露调用栈/配置。

浏览器发送 X-Request-ID UUID；中间件只接受合法 UUID，否则生成新 UUID，并在所有响应回传。编号是非可信追踪信息，绝不用于权限或幂等；客户端可重复/伪造编号，查询时同时看时间、方法和路由。`CUERELAY_BUILD` 为公开构建标签（1–80 个字母/数字/下划线/点/连字符），默认 unknown，响应通过 X-CueRelay-Build 暴露。

`http_result` 记录请求编号、路由模板（不是原始地址/查询）、方法、状态、单调耗时、结果和构建。`http_exception` 记录相同编号、异常类型及最多 12 个源码相对路径/行号；不记录 exception message、locals、源码文本、headers/body、用户信息或字幕。依赖栈路径标记 dependency。Django request/security/server 日志也使用安全 formatter，丢弃原始文本，保留异常安全栈与可获得的 requestId。进程启动配置错误仍由进程管理器处理。

## 输出、轮换、查询

默认每条 JSON 一行输出到 stderr，适配开发终端和现有 Django ASGI 部署。**生产多进程使用 stderr 及进程管理器的轮换**，不要让多个进程写同一个 Python RotatingFileHandler 文件。

单进程本地/维护部署可设置 `CUERELAY_DIAGNOSTIC_LOG=/absolute/private/path/diagnostics.log`：延迟打开，5MiB/文件，保留 3 个备份（含当前共最多约 20MiB），UTF-8。目录需预先创建，限制维护者读写权限。日志写入或磁盘满不改变 HTTP 结果。默认不产生库内日志下载接口，也不会把整台机器日志装进用户导出的 JSON。

本机开发示例（shell 已加载 .env）：

```sh
CUERELAY_DIAGNOSTIC_LOG="$PWD/.local-dev/diagnostics.log" CUERELAY_BUILD=local-dev \
  .venv/bin/python backend/manage.py runserver 127.0.0.1:8000 --noreload
rg --fixed-strings '用户诊断 JSON 中的 requestId' .local-dev/diagnostics.log*
```

使用 systemd journal 的多进程部署例：配置服务写 stderr，运行 `journalctl -u cuerelay --since '1 hour ago' -o cat | rg --fixed-strings '请求 UUID'`。对应 journald 的有界示例：在该主机专属的 journald 配置设置 `SystemMaxUse=100M`、`MaxRetentionSec=7day`，按该部署的变更流程应用。它影响主机日志预算，不能不经评估直接用于共享主机；容器部署使用其日志驱动的等效大小/份数预算。仓库的 Nginx 示例只代理 Django，不负责启动/轮换 ASGI 进程，部署者必须配置其中一种有界日志收集方式。

先从用户 JSON 找 http/request 的 requestId、时间和 status，再查询服务端同编号的 http_result/http_exception。对无响应请求，可能服务端已提交但响应丢失；维护者结合业务 revision 核实。到达 Django 前被代理拒绝、网络断开或进程被杀的请求，可能只有浏览器开始记录，不能据此认定业务未执行。无需服务端日志下载接口。

验证：加载隔离 PostgreSQL 测试配置，`.venv/bin/python backend/manage.py test diagnostics http_api.test_identity projects.tests projects.test_splitting --noinput`。包含真实 CSRF/401/200/409 请求关联、500 脱敏、伪造编号及日志失败不影响响应；不写开发业务库。验证记录见 docs/experiments/diagnostics-v1.md。
