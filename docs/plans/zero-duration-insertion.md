# 零时长字幕插入

2026-11-12 用户确认：普通前后插入遇到紧贴边界时，沿用 Aegisub 行为，创建起止时间相同的空行，之后由用户调整。

## 实现边界

- 已应用字幕契约由 `0 ≤ start < end` 改为 `0 ≤ start ≤ end`；保持整数、10ms 网格、时间/数量/格式上限。统一前端模型与后端 codec，让新行可编辑、预览、复制、保存、导出和重新导入，不增加临时行标记或第二套文档。
- 普通插入保留原时间计算、空正文、active 样式、文档顺序、选择和一次撤销；移除无间隔拒绝。零点前插入同样得到 0–0，不自动拉长。
- 视频帧读取仍要求吸附后有正时长；拆分仍要求两半都有正时长。普通重复可保留已有零时长行。
- 预览接受零时长；该行不占播放区间。试听选区为空时沿用返回 null。QC 以时长过短警告，不计算零时长 CPS。
- 更新架构入口、时间不变量及相关模块契约；历史计划/实验记录保留原执行事实。

## 验证

覆盖紧贴前后插入、零点、保持原行与样式、重复/删除及撤销重做、调整零时长行、ASS/剪贴板/检查/HTTP 往返、零时长试听和 QC、帧精度与拆分保护。执行前端测试和构建、纯格式与无数据库 HTTP 测试、真实 Chrome 行菜单回归，记录实际结果。

## 执行结果（2026-11-12）

- `cd frontend && npm test -- --run`：46 文件、409 项通过，包含零时长插入/编辑/预览/QC/试听与真实 240fps 帧精度保护。
- `cd frontend && npm run build`：类型检查和生产构建通过；保留既有大 chunk 提示。
- `PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/ass_format -t backend`：69 项通过，覆盖零时长 ASS/剪贴板往返与只读检查。
- `.venv/bin/python backend/manage.py test http_api.tests.ConversionContractTests http_api.test_clipboard http_api.test_qc --settings=application.test_settings --noinput -v 1`：15 项通过，无数据库测试。
- `cd frontend && npm run test:ass-compatibility`：通过，新增真实 JASSUB WASM 验证：含正文的零时长行保留在 track 内，在 2.99/3/3.01 秒均不可见，延长到 5 秒后恢复渲染；既有格式语料回归通过。
- Vite `127.0.0.1:5201` + `npm run test:subtitle-line-menu`：15 组 Chrome 流程通过，包括紧贴空行、选中、撤销重做和延长时间；项目保存/重载使用隔离 HTTP fixture，并调用真实 codec 预检，不代表真实数据库验收。
- `EDITING_URL=http://127.0.0.1:5201/workspace/local npm run test:editing-operations`：15 组 Chrome 流程及项目拆分快照检查通过，倒序保护与原拆分规则保留。
- `git diff --check`：通过。生产代码未新增模块依赖边；复用原模型、历史与 codec，不引入循环依赖或新保存接口。

未完成：新增 `projects.tests.ProjectContractTests.test_zero_duration_cue_can_be_saved_reloaded_and_extended` 的真实 PostgreSQL 回归。专用测试端口 55433 无服务；尝试 `docker compose -f compose.test.yml up -d --wait` 时 Docker daemon 不可用。未改用 SQLite，未访问开发数据库。启动专用测试库后按 docs/testing.md 执行项目测试。
