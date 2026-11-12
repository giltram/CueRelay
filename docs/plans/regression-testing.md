# 自动化回归测试首轮

审计日期：2026-11-11。范围限于测试、隔离运行环境、CI 和运行文档；不修改产品行为、领域模型或实时协议。

## 现状与基线

- 后端已经使用 Django/unittest：纯 ASS 转换、HTTP 契约、真实 PostgreSQL 持久化、迁移回滚和多连接事务竞争。无需引入 pytest 或平行测试设施。
- 前端已经使用 Vitest（46 个文件、406 项）和 Playwright library 浏览器脚本。历史/拆分等脚本使用真实浏览器与纯 codec，但多数项目 HTTP 持久化和冲突是测试夹具。
- ASS 已有手写语义期望语料、Import→Export→Import、项目持久化往返，以及真实 JASSUB WASM 独立解释检查。复用这些断言，不用快照替代。
- 权限已有 member/organizer/dev、跨组织、撤权、停用、CSRF、账号一致性以及最后 organizer 并发保护；样式已有模板快照、导出、原子批量操作和旧 revision 拒绝。
- 尚无 `.github/workflows`。既有浏览器脚本依赖各自端口、Chrome/FFmpeg，部分采用固定等待，不能直接全部当成稳定 CI。
- 本机前端 406/406、类型检查通过；后端独立临时 PostgreSQL 16.2 集群执行 180 项：179 通过，1 项既有 Nginx 测试因未安装 Nginx 跳过。CI 安装 Nginx 并运行该测试，不以跳过掩盖失败。

## 实施顺序

1. 增加专用测试 settings：只连接 loopback 专用测试 PostgreSQL，忽略生产 PG* 配置，Django 创建进程独有测试库并销毁；记录新克隆运行命令。
2. 首轮只增加两条真实浏览器/HTTP/PostgreSQL 回归。Django LiveServerTestCase 每例重新播种固定账号/项目并清空数据库；Playwright Test 使用现有 playwright 包，管理 Vite 和浏览器 context，失败保存 trace/截图。视频由 FFmpeg 合成，不接触实际片源。
   - 创建字幕、撤销/重做、显式保存、拆分立即保存、撤销后使用最新 revision 再保存、刷新读取已保存快照。
   - 同会话两个独立页面工作区读取同版本，先保存者成功，旧版本保存返回 409；失败保留正文/原始时间草稿，导出备份不改服务器，显式重载才接纳远端快照。
3. 原计划以 GitHub Actions 组合运行上述检查；2026-11-11 按用户要求暂缓。workflow 草案仅保留本地，并由 `.gitignore` 忽略，不提交、不触发；本地测试入口继续使用。

## 首轮边界与后续

不迁移全部旧浏览器脚本，不引入测试专用产品 API，不做完整协作/真实媒体/多浏览器验收。权限和样式规则先由既有真实数据库集成测试守护。下一轮优先补浏览器撤权后稿件备份、样式设置与旧工作区冲突、网络提交成功但响应丢失，以及按平台整理旧浏览器脚本。

## 实际执行与验收

2026-11-11，macOS arm64 / Python 3.11.8 / Node 26.4.0 / PostgreSQL 16.2。未加载 `.env`；另建 `/tmp` 临时 PostgreSQL 集群、loopback 55433，未访问开发或生产业务数据。

- 后端新配置：180 项中 179 通过、1 项既有 Nginx 测试因本机未安装 Nginx 跳过；不能将该项记为通过。Django check / makemigrations --check --dry-run 通过，无迁移变化。
- Vitest：46 个文件、406 项通过；typecheck / 生产构建通过。构建仍有既有大 chunk 提示，不是失败。
- `test:ass-compatibility`：真实 JASSUB WASM 的 F1–F4/R1–R3、模型样式身份与四份有效语料字形往返通过。
- 许可源码单测：5 项通过。
- 新增 E2E：正常顺序 2/2 通过（12.228s），`--reverse` 反向顺序 2/2 通过（12.320s），均为新建数据库/浏览器，无自动重试。
- `git diff --check`、Docker Compose `config --quiet`、actionlint 1.7.12 检查通过。Docker 容器未在本机实际启动；本机执行使用上述独立 PostgreSQL 集群。
- GitHub Actions 尚未远端运行，现按用户要求暂停启用；草案已包含 Nginx 安装及完整代理测试，但由 `.gitignore` 忽略，仅保留本地。Linux service / 浏览器安装留待用户决定恢复 CI 后验证。

实施中失败均定位到测试环境/编排：Playwright working directory、缺少锁定 Chromium，以及重载后向旧播放器选片。已修正为显式目录、安装匹配浏览器、等待新字幕行出现后选片。既有跨进程登录测试原先隐式继承父 settings，而新测试 settings 故意忽略 PG*；子进程现显式使用 application.settings 读取从**当前测试连接**复制的 PG*，原限流断言完整保留。未发现需要更改产品行为的失败证据，未修改产品逻辑/领域模型/协议。
