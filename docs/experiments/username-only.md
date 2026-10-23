# 移除显示名验证记录

2026-10-24，按用户要求取消独立显示名，统一 username。没有重命名账号或改变登录、权限、字幕保存方式。

## 实现

- accounts.User 删除 display_name；新增 0003_remove_user_display_name 增量迁移，旧迁移保留。
- Session/本人身份只返回 id、username、is_dev；成员和项目更新/归档操作者不再返回显示名。
- Admin 移除显示资料表单；密码相似性仍检查 Django 标准身份字段，不再配置已删除字段。
- 顶栏、成员表、移除确认、项目列表统一 username；个人设置删除显示名输入，保留密码与快捷键。
- 更新播种数据、契约测试和浏览器定位，不保留兼容占位或显示名回退。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| Django accounts/ass_format/http_api/organizations/projects | 最终 62 项通过；独立 test_cuerelay_username_* PostgreSQL 库，由运行器创建/清理 |
| 迁移回归 | 从 accounts.0002 建立带旧显示名的账号，再迁至最新；账号主键/密码可用性、组织关系、项目归属/正文、快捷键与已登录 Session 均保留 |
| 身份/成员/Admin/项目 HTTP 契约 | DTO 不含显示名；项目更新者/归档者只含 username；Admin 添加/修改页没有显示名字段；本人资料 PATCH 继续拒绝 |
| 前端单元 | 19 文件、187 项通过 |
| 前端 typecheck/build | 通过 |
| Chrome 用户系统回归 | 完整 user-system.mjs 9 组通过，无 pageerror |
| Django check / makemigrations --check --dry-run | 通过，无遗漏迁移 |
| git diff --check | 通过 |

Chrome 147.0.7727.101 使用全新 cuerelay_users_browser_1792775130 库及 8194/5194 临时服务。浏览器覆盖仅用户名/无显示名、成员管理与确认/取消、密码修改与快捷键、组织/账号切换保护、跨标签页失效和同账号继续原稿；没有使用或修改真实账号。个人设置截图已查看，位于系统临时目录 cuerelay-users-browser-JS4I6Z/personal-settings.png。前端完整项目/导航/音频脚本本轮未重跑，后端项目契约和用户系统浏览器流程已执行。

## 当前开发数据库升级

已停止原 8000 后端，对 .env 指向的 cuerelay_browser 执行 `migrate accounts 0003_remove_user_display_name`，随后原端口重启。迁移前后对 accounts_user（排除 display_name）、个人设置、登录限制、组织、成员关系、项目及 Session 七张表的行数和内容摘要进行比较，全部一致；未输出账号、密码摘要、Session 或字幕正文。前端继续运行于 5173 并热更新，首页、Session API 和 Admin 登录页均返回 200。

迁移按要求删除旧显示名列及其值，回退只能恢复空字段，不能恢复旧值。其他数据库/部署须同步应用迁移并更新前后端。本轮不涉及生产发布。
