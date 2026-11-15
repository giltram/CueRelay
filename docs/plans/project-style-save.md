# 项目样式保存的版本刷新与安全重试

范围：打开样式管理前读取最新项目；弹窗打开后字幕保存造成的版本冲突可安全重试一次。工作区自动接纳远端样式与撤销历史不在本次范围。

约束：

- 保持现有整个项目 revision、后端事务/权限/格式/使用数验证，不新增 API 或数据库字段。
- project-data 拥有重试策略：仅 project_conflict 可触发读取，source/styles/script 必须全部未变；assign 还要求目标 Cue 存在且原样式分配未变。
- 重试提交最新文档与最新 revision，绝不把旧字幕快照配上新版本。
- 真实样式冲突、归档、网络/未知结果、第二次竞争不自动重试；不在失败时接纳新的保存基准，保留表单。
- 设置页打开前刷新及成功保存仅更新未修改的名称/说明，保留用户草稿；工作台文档/revision/媒体/历史继续独立。
- 若自动刷新发现名称/说明的同字段竞争，标记待核对；不允许样式版本前进绕过元数据冲突，用户显式刷新核对后才能保存。

验证计划：策略单元测试覆盖字幕变化、所有样式操作边界、真实冲突/分配冲突/重试上限/未知结果；真实 PostgreSQL 浏览器场景覆盖打开前刷新、弹窗中字幕保存后的重试、同样式冲突保留及服务器快照；运行既有设置/样式浏览器测试与类型检查。

## 完成与验证（2026-11-14）

上述范围已完成，没有改动后端协议或数据库。已执行并通过：

- `cd frontend && npm run test -- --run src/project-data src/style-ui`：3 个文件，32 项，其中安全重试策略 23 项。
- `npm run typecheck`、`npm run build`：通过；构建仍报告现有大于 500kB 的 bundle 提示，未在本任务拆包。
- `PROJECT_SETTINGS_URL=http://127.0.0.1:5235 npm run test:project-settings`：真实 Chrome + HTTP 夹具；自动刷新/草稿保留、读取失败、名称竞争保护、显式核对恢复及原有设置功能通过。
- `STYLE_MANAGEMENT_URL=http://127.0.0.1:5235 npm run test:style-management`：真实 Chrome / codec / JASSUB + HTTP 夹具；完整样式操作、模板、导出、预览、窄屏和工作台隔离通过，无页面异常或意外请求。
- `.venv/bin/python backend/manage.py test browser_tests.regression.WorkspaceRegressionTests.test_project_styles_refresh_and_retry --settings=application.test_settings --noinput -v 2`：真实 Chromium / Django / PostgreSQL 通过。断言打开前刷新、弹窗中保存字幕后一次重试及最新行保留、真实样式冲突重复保存不覆盖、重新打开获取最新样式、旧工作台保存仍保护草稿。
- 前端相对 TypeScript import 扫描（含类型引用）：186 个模块、516 条边，无环；新依赖保持 project-ui → project-data → contracts。
- `git diff --check`：通过。

真实数据库测试使用隔离临时库，结束后销毁；临时 Vite 和测试容器已停止。没有实现工作台自动接纳样式或细粒度样式属性合并；任何样式定义变化均保守保留冲突。
