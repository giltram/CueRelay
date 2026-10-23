# 账号安全验证记录

日期：2026-10-23。执行范围为本地隔离 PostgreSQL，与生产部署无关。完整行为及部署步骤见 [安全契约](../account-security.md)。

## 环境与结果

Python 3.11.8、Django 5.2.18、PostgreSQL 16.2。独立临时集群位于 /private/tmp/cuerelay-security-pg，仅本机 55433 端口；Django 自动创建/删除 test_postgres，未读取业务 .env 或迁移现有业务数据库。无新产品依赖。

| 实际执行 | 结果 |
| --- | --- |
| python backend/manage.py test accounts http_api organizations ass_format --noinput | 44 项通过（原 28 项 + 新增账号安全 16 项），6.220 秒；真实 PostgreSQL |
| python backend/manage.py check | 0 issues |
| python backend/manage.py makemigrations --check --dry-run | No changes detected；已有 0002_loginattempt 与模型一致 |
| npm run typecheck | 通过 |
| npm run test -- --run | 7 文件，88 项通过 |
| npm run build | 通过，包含最终密码提示修改 |
| git diff --check | 通过 |
| Python AST 静态 import 图 | 检查 25 个后端模块，无循环，accounts 无向上仓库依赖 |
| check --deploy（随机临时 SECRET_KEY、DEBUG=0） | 有 3 个既有部署告警：security.W002/W004/W008，未宣称部署检查通过 |

首次使用短的公开测试密钥运行 check --deploy 还产生 W009；改用临时随机密钥复查后剩上述 3 项，不推断真实部署密钥的安全性。

## 覆盖内容

- 实际 CSRF 客户端登录既有 8 字符密码成功；改密 14 字符被拒绝，15 个纯小写字符成功；旧密码错误不能改密；当前 Session 保留，既有 HTTP 测试覆盖其他旧 Session 失效、登出及 CSRF 旋转。
- Django 验证器保留常见弱密码、纯数字和 username/first_name/last_name/email/display_name 相似性检查；1024 字符接受、1025 拒绝。Admin 实际 POST 验证创建、成员重置、本人改密，不只直接测试 settings 或表单类。
- API/Admin 共用账号计数，变换 IP 不改变限制；普通密码错误/不存在账号/停用账号响应一致。首次 4 次错误为 401，第 5 次及之后 429，并附 Retry-After；Admin 普通错误保留表单，达到限制切换到相同 429 JSON。
- 15 分钟滑动窗口丢弃旧失败；成功登录清空失败；锁定请求不计算密码哈希、不修改截止时间；模拟时间超过 5 分钟恢复登录并清空状态，不用真实等待 5 分钟。
- 对存在和不存在账号分别发起 10 个真实 HTTP 客户端请求，使用独立数据库连接、同步起跑、不同 IP/User-Agent。均只有 5 次调用 ModelBackend 的实际密码校验；结果为 4 个 401 和 6 个 429；只生成一条状态，保存 5 次失败。覆盖首次记录创建竞争。
- 6 个独立 Python/Django 进程并发调用实际 HTTP 登录处理链，连接同一测试库，得到 4 个 401、2 个 429；主进程随后正确密码也被拦截。说明跨进程状态共享，不依赖内存计数；这不是实际生产服务器/负载均衡部署验收。
- aauthenticate 共用限制；旧 ModelBackend Session 仍可读取；全角/首尾空白用户名不能拆分计数。敏感日志只含事件和账号摘要。
- API/Admin 超长密码在哈希前拒绝，超 32 KiB 请求在 CSRF 表单解析前拒绝；两个 1024 字符非 BMP Unicode 密码即使 JSON 使用 surrogate 转义仍能改密；非法孤立 surrogate 拒绝，不产生 500。
- 过期状态清理只删除至少 24 小时未更新记录，保留活动计数。

部分新测试为加快执行显式使用 MD5 测试 hasher；仅测试设置，生产哈希配置保持 Django 默认，原有 HTTP 回归仍使用正常哈希配置。冷却测试注入时钟，不修改生产时间。

## 文件清单

- backend/accounts/backends.py、models.py、services.py、password_validation.py、tests.py、README.md。
- backend/accounts/migrations/0002_loginattempt.py。
- backend/accounts/management/__init__.py、management/commands/__init__.py、management/commands/clear_login_attempts.py。
- backend/application/settings.py。
- backend/http_api/auth_security.py、identity_views.py、test_identity.py。
- frontend/src/account-ui/PersonalPanel.tsx（长度属性与占位提示，保持原 label 和布局）。
- README.md、docs/architecture.md、docs/user-system.md、docs/account-security.md、docs/plans/account-security.md、docs/experiments/account-security.md、docs/experiments/user-system.md（标注旧限速已经替换）。

任务开始时 frontend/src/App.tsx 已有本地修改，本任务未编辑该文件。

## 尚未验证或实现

没有生产发布、业务数据库迁移、HTTPS/反向代理、多 worker 服务器流量或新一轮浏览器端到端验收。保留的浏览器脚本使用的“新密码”精确 label 未变。生产部署需补齐 X-Frame-Options、HSTS、HTTPS 重定向并按实际拓扑复查，执行迁移/重启/每日清理；nginx 单 IP 限速和网络层请求体/超时配置仍未实施。无 CAPTCHA/MFA。
