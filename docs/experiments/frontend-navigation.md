# 前端导航验证记录

2026-10-24。实现正常路径 History 路由、真实项目链接、默认新开列表及单个工作区保留。未修改后端公开 API，没有自动保存、草稿持久化或标签页同步。

## 环境与数据

Node 26.4.0，仓库锁定的 Vite/Vitest/Playwright，Chrome 147.0.7727.101，本机 PostgreSQL。新建 `cuerelay_navigation_browser_1792771799` 并执行迁移和专用项目播种；没有重置已有项目库/业务库。测试密码随机生成，仅保存在系统临时私有环境文件。后端运行于 8191，dev 5191，构建 preview 5192，均为回环地址。59 个后端测试另由 Django 创建和清理独立 test_cuerelay_navigation_* 数据库。

验证结束已停止本次 8191/5191/5192 服务，删除本次隔离导航库及临时密码文件；原有数据库和服务未清理。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| `python backend/manage.py check` | 通过，无问题 |
| Django accounts/ass_format/http_api/organizations/projects | 59 个测试通过，包含真实 PostgreSQL 权限、版本和并发契约 |
| `cd frontend && npm run test -- --run` | 19 个文件、187 个测试通过；包含路由解析和受保护历史控制器 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，构建前也执行 TypeScript 检查 |
| `frontend/browser-tests/navigation.mjs` 对 dev | 导航场景通过，无 pageerror |
| 同脚本对构建 preview | 导航场景通过，无 pageerror |
| `cd frontend && npm run test:navigation` 对最终 preview | 10 组场景全部通过并正常退出；夹具路径不依赖当前工作目录 |
| `frontend/browser-tests/projects.mjs` | 原有 8 组项目端到端检查通过 |
| `frontend/browser-tests/main-audio-integration.mjs` | 原有 4 组项目/音频集成检查通过 |
| `cd frontend && node browser-tests/audio-timeline.mjs` 对构建 preview | 通过，含字幕提交/删行、焦点/IME、时间轴、播放头、标尺、DPR、区间配色与窄屏；无 pageerror/媒体上传 |
| 相对静态 import 图审查 | 54 个生产 TypeScript 模块无循环；navigation 无向上依赖，app-workspace 只依赖 contracts/project-data/navigation 路由类型 |
| `git diff --check` | 通过 |

命令均使用相应的测试环境变量，运行说明见 [前端部署](../frontend-deployment.md)。完整 legacy user-system.mjs 未在本轮执行；新导航脚本覆盖了同账号恢复、跨账号切换取消和主动退出取消，后端账号/组织测试亦已执行。

## 导航回归覆盖

- 创建成功的 URL/历史变化、创建时 File 直接启用编辑，history.state 只含 group/index。
- 创建后回退到列表，前进及点击同项目复用 video/输入节点、Object URL、字幕、未提交时间、选中行、显示模式和播放位置。
- 工作区默认新开列表时原页 URL/可见性不变，视频保持播放且 currentTime 继续推进。新标签页没有原工作区 File/未保存草稿。
- 真实 href、普通点击、中键、ControlOrMeta 新开；刷新保持项目 URL，重新选片完整校验后启用编辑。
- 未登录直接进入非默认组织项目，登录/刷新均保持请求的组织和项目。
- 普通项目/组织导航、前进与回退的保护确认/取消；取消后 URL、组织及实际显示一致，前进历史没有被取消操作替换。
- 新建前可取消替换保留实例；实际刷新触发原生 beforeunload，拒绝刷新后内存仍在。
- 真实服务器 403、404、归档只读；未知页面；注入 503 后重试成功；延迟项目响应不能覆盖返回列表后的路由。
- 无组织的 `/workspace/local` 和 `/projects` 列表入口；本地会话恢复保留草稿/video；取消跨账号切换和退出仍保持原 URL/稿件。
- 组织/项目/本地深路径返回前端入口，/api 未知接口仍 404，/admin/login/ 返回 Django 页面，Admin CSS 正常返回。

浏览器断言等待 URL 和对应页面完成提交，避免把 popstate 恢复过程中短暂出现的目标地址当作已完成导航。原生取消刷新探针使用独立的浏览器上下文，探针结束后正常离开文档；测试结束关闭各上下文及浏览器。较早将取消刷新探针与主历史测试混用的调试运行曾在清理等待时中断，隔离探针后最终构建回归正常退出，最终结论以正常退出的完整运行为准。

截图位于系统临时目录，包括最终 dev 导航 `cuerelay-navigation-Zwv2Wl`、最终 npm/preview 导航 `cuerelay-navigation-899DjC`、项目 `cuerelay-projects-nt1nxX`、集成 `cuerelay-integration-XqkxNc` 和时间轴 `cuerelay-timeline-jb7ky0`；这些不是长期保存的仓库附件。

## 未验收与边界

没有可用的本机 Nginx；Docker CLI 存在但 daemon 未运行。因此没有执行 nginx -t，也没有生产代理/TLS/公网部署验收。提供了按前缀隔离 API/Admin/静态资源、前端路径回退的 Nginx 示例和响应头片段；实际部署必须配置路径、MIME、collectstatic、HTTPS 并执行部署文档检查。Vite preview 的通过不能代替该验收。

仅验证上述 Chrome；未验收 Safari/Firefox、真实长片和操作系统后台播放调度。刷新/新标签页只读取显式保存的服务器快照，仍需重新选视频；没有跨标签页恢复未保存内容。单个保留实例只覆盖列表往返；确认切换到其他项目后，不能借浏览器历史恢复已明确放弃的旧草稿。

首次后端测试命令因临时 TEST 配置缺少 MIRROR 未执行测试，改为仅覆盖已规范化的 TEST.NAME 后通过。音频脚本首次从仓库根运行因夹具相对路径失败，改为其规定的 frontend 工作目录后完整通过。未把这些失败尝试记为通过。

## 链接样式补验

2026-10-24：真实链接转换时遗漏了原按钮的视觉样式。现有控件样式扩展到显式 `.button-link`，涵盖项目列表/返回工作区、本地工作区、打开/只读查看、错误返回及 Admin 入口；文字链接使用既有主题色，仅悬停显示下划线，键盘焦点保留可见轮廓。aria-current 复用当前导航样式，href/target/点击处理未改动。

重新执行 typecheck/build，通过。独立 Chrome 页面使用模拟 Session/组织/项目数据验证主题色、同一行按钮/链接高度、hover/focus、归档入口、390px 布局及工作区列表的 href/新标签页 target，全部通过且无 pageerror；未修改现有账号/项目数据。截图为系统临时目录 cuerelay-links-desktop.png / cuerelay-links-mobile.png。两次早期样式断言分别误把 flex 子项的计算值要求为 inline-flex、误比较表格内外不同字号控件的高度；改为检查实际 flex 布局和同一行控件后通过，未为测试误判修改布局。

## 标题返回首页补验

2026-10-24：用户要求点击 CueRelay 返回根目录。各页标题统一为指向 `/` 的 HomeLink；首页展示当前可访问组织列表并保持 `/`，不再自动替换成组织列表地址。EditorWorkbench 通过 title 插槽接收链接，不引入向 navigation 的依赖。回首页只浏览列表，保留工作区，不要求放弃内容。

本轮重新执行 187 个前端单元测试、typecheck/build、diff --check，全部通过。独立 Chrome 使用模拟 Session/组织/项目响应及真实合成 MP4 验证：列表、项目、本地、错误和登录页标题均返回 `/`；地址保持根目录；回退/前进/返回工作区保留同一 video、1.25 秒播放位置、字幕和未提交时间草稿，无 pageerror。没有修改现有数据库。主 navigation.mjs 已补充首页与工作区往返断言，但本轮未重跑其整套真实数据库流程，先前完整回归结果仍是此前版本的记录。
