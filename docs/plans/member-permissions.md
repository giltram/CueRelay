# 组织 member 可配置业务权限

目标：每组织一套14项布尔权限，默认保持旧行为；dev/organizer固定全业务能力，身份/成员管理不进入配置。

实施顺序：
1. organizations拥有固定权限契约、JSON默认覆盖及独立CAS版本、管理者配置读写；有效权限随组织/项目读取返回。
2. 业务服务在User → Organization锁内按操作鉴权；字幕/样式完整快照同时验证权威基准和实际cue变化，保持原CAS/归档/来源约束。
3. 前端按有效权限显示各独立入口；组织设置14项分组复选框、显式保存及冲突重载。复用现有轮询/ReadOrder，只更新保留工作区的权限状态。
4. 补充权限矩阵、混合快照、CAS及竞争、前端与浏览器回归，运行实际检查并记录结果。

公共契约：合法key只来自organizations.permissions；配置PUT必须提交全部14项严格boolean及revision；未知/缺少字段拒绝，旧revision返回409。不存在的覆盖使用固定默认，迁移只新增组织配置字段。配置资源仅dev/本组织organizer可读写；普通成员只读自身effective_permissions。can_manage仍只表示身份管理权。

跨权限：普通字幕保存只允许cues变化；样式命令输入仍必须保持source/styles/script基准，无字幕编辑权限时输入cues须等于权威cues，命令输出若改变cues也须字幕权限（包括行样式分配）。创建项目权限授权完整原子初始化。

## 完成与验证

功能、配置UI、具体业务入口与文档已实现，未自动提交、推送、部署或创建worktree。任务开始git status为空。规范入口为 [成员权限契约](../member-permissions.md)，本记录保留实施与验证证据。

2026-11-22 最终验证（本机一次性PostgreSQL 16.2 / Python3.11 / Chromium；只监听loopback，不读取.env、不接触开发生产库、不用keepdb）：

- 后端全量`accounts ass_format srt_format http_api organizations projects diagnostics`：246项，245通过、1项skip（未安装Nginx的真实代理专项）。20.917秒。包括14项每项默认/全禁/仅授单项、dev/organizer全禁配置下仍可执行14项、配置/成员管理不可提权、旧版本冲突、实际迁移保留数据及真实多连接竞争。竞争通过pg_stat_activity确认实际Lock等待，覆盖写入先获得组织锁和撤权先获得组织锁，以及设置者角色撤销。
- 后端最终实际目录：`/private/tmp/cuerelay-member-permissions-07p46u29`，日志django.log、postgres.log；测试库销毁后pg_ctl成功停止。
- 前端类型检查、i18n语义/占位/中英文完整性、`npm run build`通过。构建仅有既有>500kB chunk提示。
- `npm --prefix frontend run test -- --run --exclude 'platform-tests/**'`：66文件/549项全部通过；默认Vitest命令误收集3个既有Playwright平台测试，需要Django夹具，原命令不通过。未顺带修改无关测试配置。
- `npm --prefix frontend run test:ass-compatibility`：实际JASSUB/WASM静态标签与5份语料图像往返通过。
- `python -m unittest discover -s scripts -p 'test_*.py'`：6项通过，包括全部57个浏览器入口与57场景一一对应。
- 最终真实浏览器7/7通过，51.568秒：新增配置CAS/14项中英文/身份边界，撤权乱序与恢复不丢稿/时间/历史/媒体/导出及独立术语写入，独立模板/样式/分配控件；另复跑原项目生命周期、模板持久化、组织术语fork隔离、成员关系撤权后草稿导出。证据：`/private/tmp/cuerelay-member-permissions-0adx8y40/django.log`，截图/trace在frontend/test-results各场景目录。中英文成功截图已实际查看英文布局。
- Python编译、修改的浏览器脚本语法、git diff --check通过。用AST/相对导入图检查后端及前端产品模块，未发现循环；新增依赖均向下到organizations权限边界或contracts/shared JSON。

首轮浏览器测试定位器曾误把HeaderNotice当表单内错误、混淆预览/保存status，历史断言也需先撤销时间再正文；已修正并重跑。原项目测试提示文案与跨不同读取者的整Project相等断言已同步新契约，持久内容仍完整比较。所有最终7场均无重试通过。

限制：未执行全部57场浏览器、Firefox/WebKit或真片源人工验收；Nginx专项未执行。权限通过既有focus/visibilitychange/30秒检查传播，服务端每次写入立即重新校验。项目detail现在包含读取者特定effective_permissions，跨账号比较持久数据时必须排除此投影。迁移只在一次性测试库执行，部署前仍需按现有流程应用organizations.0003。

进一步维护建议（未顺带实施）：Vitest应排除platform-tests目录，使默认单元命令不误收集浏览器套件。
