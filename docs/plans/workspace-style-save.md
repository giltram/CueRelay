# 工作台保存时接纳远端样式

日期：2026-11-15。范围：仅显式「保存项目」发生明确 project_conflict 后，确认服务器字幕与上次成功保存的基准完全相同、ASS source 未变，再把最新样式/脚本与本地字幕组合，按最新 revision 重试一次。已有设置页安全重试不变。

责任与约束：

- contracts/projects 声明内存保存输入/结果，输入含保存基准及当前/撤销/重做所引用的样式 ID；这些辅助字段不发送给后端。
- project-data 编排一次冲突读取/重试；只发送最新样式和本地 cues。远端字幕、ASS source、本地样式基准变化、任何历史引用已删除样式、归档及未知提交结果均不合并。后端 CAS/权限/格式校验不变。
- subtitle-model 提供纯样式快照替换；workspace-ui/history-styles 只在保存成功后更新当前和历史快照的样式，缓存转换以保留文档共享引用，不创建撤销步骤或清空分支。
- EditorWorkbench 唯一拥有 document/savedDocument/revision/history；app-workspace 只编排接口并更新摘要，不读取编辑器内部。保存失败不采用远端样式或版本。
- 当前行、多选、未应用/非法时间草稿、媒体节点/位置、视窗保持；远端样式同步不进入本地撤销操作。工作台原生输入历史通过既有 epoch 边界失效，避免带回旧样式。

步骤：

1. 实现保存策略、历史转换与显式接口，补充纯函数测试。
2. 增加真实数据库浏览器回归：未保存编辑+远端字号、重试次数、草稿/媒体保留、撤销重做后继续保存，以及远端字幕竞争/删除历史样式的拒绝路径。
3. 更新既有样式回归的旧冲突期望，执行相关测试/构建/依赖检查并同步架构文档。

不实现后台自动同步、完整三方字幕合并、自动替换被删除的样式，或拆分接口的冲突重试。

## 完成与验证

上述实现已完成，未新增 HTTP API 或数据库迁移。保存输入中 baseDocument/requiredStyleIds 只在前端模块间传递，HTTP 仍只有 revision/document。

真实回归发现 PostgreSQL JSONB 会重排 Cue 对象键；新增 subtitle-model/snapshot-equality 按内容比较 JSON，忽略对象键序但保留数组顺序、字段存在性和标量类型。设置页重试也复用该比较，防止相同定义误报冲突。删除历史样式的浏览器夹具通过样式名称定位 ID，避免误选原 ASS 已有的第二个样式。

最终执行结果（2026-11-15）：

- `cd frontend && npm run test -- --run`：53 个文件、469 项通过，包括保存策略、历史映射、JSONB 键序和既有前端回归。
- `npm run build`：类型检查与生产构建通过。仍有既有的超过 500kB bundle 提示，本次未拆包。
- `.venv/bin/python backend/manage.py test browser_tests.regression --settings=application.test_settings --noinput -v 2`：6 个真实 Chromium / Django / PostgreSQL 场景全部通过，约 39 秒。覆盖保存刷新/拆分/历史、远端字幕冲突保护、术语隔离、设置页刷新与双向安全重试，以及新增的未保存字幕合并字号/原始非法时间草稿/当前行/同一视频节点和位置/历史共享基准、撤销重做后继续保存、删除历史所需样式时不重试且保留历史。
- 前端相对 TypeScript import 扫描：193 个模块、535 条边（含类型引用），无环。依赖保持 App → app-workspace → project-data → subtitle-model → contracts；workspace-ui 历史模块不导入其编排消费者。
- `git diff --check`：通过。

工作台没有新增按钮、确认或后台版本接纳；样式设置提示已更新为下次保存尝试合并。历史所需样式被删除时保守拒绝，要求先备份/核对，不静默清空历史或替换样式。测试使用隔离临时库，结束后销毁数据库并关闭测试容器。
