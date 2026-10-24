# 项目设置页面验证

2026-10-24。列表移除打开/只读查看操作，项目名称继续链接工作区；项目设置、归档/恢复直接显示。项目设置使用独立 URL 和默认新标签页，可修改名称及说明。创建弹窗只负责初始化。

实际执行：

- `npm run build`：通过（含 TypeScript 检查）。
- `npm run test -- --run`：22 个文件、233 项测试通过。
- `PROJECT_SETTINGS_URL=http://127.0.0.1:5188 npm run test:project-settings`：Chrome 147.0.7727.101 通过，页面错误和未预期请求均为零。
- 相对 TypeScript import 图检查：60 个源文件，无循环；`git diff --check` 通过。

浏览器验证使用 HTTP 夹具，不访问开发数据库：直接可见的列表操作、项目名称链接、新标签页和 opener 隔离、指定组织/项目深链接、登录后继续、名称/说明保存及页面刷新、必填名称、revision 冲突、请求失败与重试、显式刷新保留输入、归档只读、普通成员无管理权限。检查了 1440px 和 390px 设置页面截图及横向溢出。

后端接口和数据库模型未改动。本次没有重新执行依赖真实 Session/数据库的 projects/navigation/tab-navigation/main-audio-integration 浏览器脚本；已同步其入口选择器，并通过 Node 语法检查。保存持久性及权限的浏览器检查基于夹具，不代替真实数据库、生产环境或其他浏览器验收。
