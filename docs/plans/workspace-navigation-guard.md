# 工作区离开确认（2026-11-21）

目标：保存后的项目不因仍加载项目/视频而反复提示；有未保存改动时，在离开工作区前确认，而不是进入列表后新建项目时才确认。

## 实施与边界

1. `workspace-ui/workspace-changes.ts` 从编辑状态和成功保存基准计算文档变化、未应用时间及 unsaved，供导航、IndexedDB 草稿、QC、诊断共用。文档按快照内容比较；编辑改回原值/撤销到保存版本恢复 clean，保存后再次编辑恢复 dirty。
2. `app-workspace/navigation-transition.ts` 计算当前/目标路由的离开和替换边界，不操作编辑状态或 History API。App 在 commit 前检查 WorkbenchHandle.leaveState；取消不切换页面；保存并离开必须等原保存接口成功且当前内容全部保存；明确放弃才销毁原实例并清理活跃草稿。后续新建不重复提示同一份旧稿。
3. 无改动或保存成功后仍可隐藏保留实例与媒体，浏览器历史恢复它。明确放弃后的历史重返加载服务器快照；已保存项目不删除。新标签页保持原有独立行为。
4. 未应用时间不自动应用，禁止「保存并离开」，提示取消后应用或明确放弃；普通保存仍只保存已应用字幕。导出备份不关闭确认、不等同于项目保存。进行中的工作区操作完成前禁止保存/放弃；刷新/关闭仅保护实际未保存内容或进行中操作。

依赖仍为 `App → app-workspace/navigation-transition → navigation/routes + contracts`、`workspace-ui → workspace-changes → subtitle-model/snapshot-equality + media/playback + contracts`；无后端、持久字段或新运行时依赖。

## 验证

- 已执行：前端 typecheck、i18n 校验、全部 Vitest（63 文件、538 项通过）、生产构建；更改的浏览器脚本语法检查及 `git diff --check` 通过；226 个前端 TS/TSX 文件的相对静态 import/export 依赖扫描未发现循环。
- 新增 `npm run test:workspace-navigation`：真实 App、Chromium、合成视频、IndexedDB、Python ASS codec 和可控 HTTP 保存，覆盖 clean/dirty、确认时机、取消、保存延迟/失败/重试、时间草稿、导出/放弃、前进/后退、新标签页和中英文。
- 本次未能执行浏览器交互：沙箱禁止 Vite 监听 loopback 端口（EPERM），Chromium 启动被环境终止（SIGTRAP）。新增和调整的浏览器场景尚待可运行环境验证，不视为通过。旧专项脚本中依赖隐藏未保存工作区的场景需随新交互调整；当前已调整主要导航/标签页及真实后端的草稿、合并、替换场景。

运行浏览器回归：先在 `frontend/` 启动 `npm run dev -- --port 5241 --strictPort`，再运行 `npm run test:workspace-navigation`。无需业务数据库。

## Review 复核与修复（2026-11-21）

针对 `fd564c3..e0f2f39` review 的两项 P2，实际重跑原脚本，确认离页备份下载等待在清理时出现未处理拒绝，以及查找脚本等待未保存工作区隐藏超时。先将下载等待和点击交给同一 `Promise.all` 后，进一步明确复现「导出 ASS」匹配工具栏及离页弹窗两个按钮的 strict mode violation。

- `workspace-navigation.mjs` 将备份点击限定在离页弹窗，下载等待和点击同步注册错误处理，避免清理错误掩盖点击失败。
- `subtitle-search.mjs` 改为断言未保存本地工作区的离页确认和取消，核对路由、原查找节点、输入、结果、字幕、选择、时间和媒体不变；隐藏/历史恢复移到未验证片源及归档项目的干净快照，核对原节点、输入、当前命中及选中行保留，同时继续验证其他页面不拦截浏览器查找。

修复后实际执行：`npm run test:workspace-navigation` 五组全部通过；`SUBTITLE_SEARCH_URL=http://127.0.0.1:5241 npm run test:subtitle-search` 全部通过，无页面异常或意外 HTTP 请求；`npm run typecheck`、两个修改脚本的 `node --check` 和 `git diff --check` 通过。首次沙箱运行受端口监听/浏览器启动限制，获取执行权限后完成以上浏览器验证，补齐前述未运行场景。

本次仅修改专项测试和说明，不改变产品离页保护、导出逻辑、模块依赖或持久化契约。HTTP 为可控夹具；未重跑真实 PostgreSQL 端到端、后端测试、全量 Vitest 或生产构建。
