# 字幕行菜单验证（2026-11-07）

已实现契约见 [字幕行操作](../subtitle-line-operations.md)。所有浏览器测试使用真实 Chrome、FFmpeg 合成片源、隔离 HTTP fixture / Python 纯 codec，不写开发数据库。

## 实际通过

- `cd frontend && npm test -- --run`：42 文件、376 测试。
- `cd frontend && npm run build`：TypeScript 与生产 Vite 构建通过。构建仍有主 chunk 大于 500kB 的提示。
- `PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/ass_format -t backend`：34 测试，包括事件顺序、Comment/隐藏元数据、剪贴板字段重排、未知样式、普通文本、覆盖范围、整批拒绝。
- `DJANGO_SECRET_KEY=local-test-only .venv/bin/python backend/manage.py test http_api.test_clipboard http_api.tests.ConversionContractTests accounts.test_shortcuts`：17 测试，不建测试数据库；包含真实 projects.validate_document_base 对粘贴结果的不可替换模板/样式校验。
- `cd frontend && node browser-tests/subtitle-line-menu.mjs`（Vite 5201）：14 组检查，55 个隔离请求，无 pageerror / 未预期请求。实际帧时间用含 B-frame 的 10fps MP4；单测另外读取真实 24fps B-frame packet 元数据。
- `SUBTITLE_SEARCH_URL=http://127.0.0.1:5201 node browser-tests/subtitle-search.mjs`：原有查找与选行/草稿/媒体/只读回归通过。
- `HISTORY_URL=http://127.0.0.1:5201/workspace/local node browser-tests/workspace-history.mjs`：原有手势、长按、文本/IME/原生历史、Modal、导入、项目保存 CAS、拆分 revision 与实例生命周期回归通过。
- 前端 113 个非测试源文件相对静态/类型导入图 DFS 检查无环；手动核对 `{account-ui, workspace-ui, style-ui, project-ui} → page-ui/Modal` 方向，通用 dialog 实现原样移动。`git diff --check` 通过。

## 新浏览器覆盖

时间排序保持；Ctrl/Cmd 多选与 Shift 范围、右键保留整组选区、键盘菜单/焦点/视窗约束；普通插入邻接边界；复制/重复/删除的文档顺序与整批撤销；两种帧分割与视频时间插入，不改变播放头；系统 ASS 剪贴板与四字段覆盖、无效区间重试、保留 raw 时间草稿和 active / 多选；无变化覆盖不增加历史；复制转换失败与剪贴板权限拒绝不删行；删空再粘贴；隐藏时丢弃迟到响应；个人快捷键保存/刷新/应用到保留工作区；未验证/归档项目只能复制；已验证项目粘贴含 Layer/Actor/Margins 的行后保存/重载并导出元数据，原始 source/styles/script 不变。

本次截图：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-line-menu-26ehGq/`（临时产物）。

## 限制

未进行真实生产数据库的全量 PostgreSQL / 事务竞争测试；本次无 ORM / schema 变化。剪贴板与菜单浏览器交互实测 Chrome，Safari/Firefox 未实测；系统/浏览器保留的键位可能需要在个人设置改绑。ASS 范围仍为原有受限子集，帧操作不支持无法解析帧元数据的媒体，不使用假定 FPS。原有 G/Enter 自动续行保持 2 秒，菜单插入为 3 秒。模板与元数据保留字段的完整输出仍受 ASS 大小/事件限制。

## 鼠标菜单初始焦点修正

右键菜单原先无条件聚焦第一项，`:focus` 样式被误认为已选中操作。现鼠标打开只聚焦菜单容器，键盘打开仍聚焦首个可用项；容器上的上箭头从末项开始，下箭头从首项开始。类型检查及完整 `subtitle-line-menu.mjs` Chrome 回归通过，覆盖鼠标初始无聚焦项、上箭头 / Home 与键盘初始首项；截图目录 `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-line-menu-wxfiJf/` 已目视检查。
