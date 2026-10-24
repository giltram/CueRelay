# 删行快捷键设置

2026-10-24。delete-row 纳入 shared/timing-shortcuts.json 与个人快捷键覆盖，删除原固定分派分支。默认 Ctrl/Meta+Delete/Backspace，保留原行为；覆盖替换四个别名，空列表禁用，恢复默认移除覆盖。前后端只对删行动作额外接受这四个修饰键组合。无模型或迁移改动。

已执行：

- 前端 typecheck、Vitest（22 文件、220 项）、build 通过。新增回归覆盖删行改键/禁用/默认恢复、精确修饰键、输入与 IME 保护、非法组合和跨动作冲突。
- 后端 http_api.test_identity：15 项通过，真实 PostgreSQL，使用随机命名的独立测试库并自动清理；覆盖设置持久化、失败不覆盖、默认归一化和原有账号/权限接口。
- Chrome 147.0.7727.101：browser-tests/delete-shortcut-settings.mjs 通过。设置页显示四个默认绑定，Ctrl/Delete、Cmd/Backspace 与 Shift+X 录制成功，保存/刷新保留；工作区验证改键后旧默认失效、输入框不能删行、留空禁用以及恢复后四个默认组合均可删行。无页面异常或意外 API 请求。
- 已目视检查 1360px 桌面与 390px 窄屏截图，新增设置行沿用原布局，窄屏无页面横向溢出。
- 扫描 81 个前端 TS/TSX 文件的相对 import 图无环，git diff --check 通过。

浏览器使用模拟 API 与本地空文档，不写开发数据库；真实设置校验与持久化由上述后端测试验证。不包含其他浏览器或生产部署验收。

复现：启动前端后，在 frontend 运行 `DELETE_SHORTCUT_URL=http://127.0.0.1:5173 node browser-tests/delete-shortcut-settings.mjs`。需要已安装的 Chrome，无需视频、FFmpeg 或测试账号；截图输出到系统临时目录。

## 逗号输入修复

2026-10-24。原 onChange 立即 split/trim/filter 再回填，导致逐字输入 `Ctrl+Delete, ` 被改回 `Ctrl+Delete`，无法继续添加绑定；原 fill 整串的检查没有覆盖该问题。先新增 pressSequentially 回归并确认失败，再改为面板内原始字符串草稿，只在保存或录制校验时解析，成功保存后格式化。

修复后 typecheck、22 文件 220 项 Vitest、build 和同一 Chrome 浏览器脚本通过。额外检查尾随逗号/空格保留、删行四个绑定逐字输入、提交动作多绑定保存/刷新及首尾空格归一化；原录制、禁用、恢复默认、输入框保护继续通过。无后端改动，本轮未重跑后端测试。
