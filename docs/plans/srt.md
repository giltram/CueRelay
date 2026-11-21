# SRT 导入与导出

目标：在既有初始化、本地导入和导出入口支持 SRT，继续使用 v2 ASS 文档、历史、草稿、保存和权限契约，不扩展实时协作或通用转换平台。

实施顺序：
1. 调研 SRT 与现有 pysubs2 的行为，固定严格、有源行定位的支持子集。
2. 新建相邻纯 `srt_format` 模块，向下使用 `ass_format` 公共验证/空文档；薄 HTTP 适配，不复制前端解析器。
3. 数据层严格 UTF-8 解码，复用项目创建的 ASS source 契约（先导出验证后的统一文档），不改持久化/保存接口。
4. 复用导入确认及 QC 导出交互；离页备份仍固定 ASS。使用现有命名、语言与布局。
5. 纯格式、HTTP、数据层与隔离浏览器/数据库回归，更新模块契约和双语手册。

用户已确认：时间按最近 10ms 舍入，5ms 向上，允许短行变为零时长；保留 b/i/u/s 与明确实体语义；不能无损映射的字面花括号/反斜线及未知标签整份拒绝，不扩展内部模型。

现有未提交改动：导航保护及相关 UI/文档/测试。开始时 `git diff` 备份到 `/tmp/cuerelay-srt-before.patch`；只作所需的增量改动，不提交、不还原他人工作。

研究依据：
- [Library of Congress](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml)：SRT 文档不统一，块结构/三位毫秒、部分 HTML 格式和编码支持有实现差异。
- [pysubs2 1.8.1 SubRip](https://github.com/tkarabela/pysubs2/blob/1.8.1/pysubs2/formats/subrip.py)：导入按时间匹配搜集，忽略坏块并 trim 正文、默认删除未知标签；导出忽略粗体，并 trim/合并换行。因此不能直接用其宽松文件读写器承担本次数据完整性契约。已实测纠正早期判断：`get_text_events()` 过滤的是 Comment/绘图，实际保留空正文和零时长。
- [FFmpeg HTML subtitle conversion](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/htmlsubtitles.c)：处理 b/i/u/s、font/br 等，但未知标签与部分花括号会被丢弃。仅作成熟实现的边界对照，不采用其容错/删改策略。

## 完成结果

- 本地导入与项目创建选择同一个 ASS / SRT 文件控件；已有项目仍禁止文件替换。
- `srt_format/{blocks,text,codec,errors}.py` 独占 SRT 规则，HTTP 仅接受 source/document，无数据库或媒体读写。通过 `ass_format` 的公开默认值、限制和完整验证接入统一 v2 文档，项目持久化和 revision 协议不变。
- 新增 `project-data/subtitle-api.ts`，严格 UTF-8/BOM 解码并按扩展名分派，不复制前端 parser。ASS 数据层和备份接口保持不变。
- SRT 导出在原 QC 面板一次说明样式损失；原始事件顺序、三位毫秒、LF、连续编号，保留空正文/零时长和有效 b/i/u/s。只导出已应用内存正文和时间，不提交时间草稿、不保存或修改 ASS。离页/本机草稿备份固定 ASS。
- 完整格式、默认值、精度/编码/标签及损失契约唯一归 [srt_format README](../../backend/srt_format/README.md)，双语手册保持原章节 ID。
- 无新依赖、迁移、实时协作、通用格式框架。现有受影响旧浏览器脚本只同步文件控件名称；未改其业务场景。

## 实际验证（2026-11-21）

所有数据库检查使用 `application.test_settings` 与 compose.test.yml 专用 PostgreSQL；各命令创建独有 `test_cuerelay_<pid>` 并销毁，不使用开发数据库。浏览器视频为临时 FFmpeg 黑色视频+音频。

| 检查 | 实际结果 |
| --- | --- |
| `manage.py test accounts ass_format srt_format http_api organizations projects diagnostics --settings=application.test_settings --noinput` | 229 项：228 通过，1 项 Nginx 真实代理测试因未安装 Nginx 跳过。不是全项通过。 |
| `npm run test -- --run` | 65 文件、543 项通过，包含整份前端相对依赖无环/diagnostics 叶子边界检查。 |
| `npm run build` | i18n、TypeScript 和 Vite 生产构建通过；有 >500kB chunk 警告，本任务未扩展拆包。 |
| `npm run test:ass-compatibility` | 已安装真实 JASSUB/WASM 的 ASS 独立语义/字形往返通过。另在纯 SRT 测试用安装的 pysubs2 1.8.1 独立读取输出，对照时间及可见正文。 |
| `manage.py check`、`makemigrations --check --dry-run` | 通过，无迁移变化；后者已在具备测试库 loopback 权限后复验。 |
| `python -m unittest discover -s scripts -p 'test_*.py'` | 5 项通过。 |
| SRT 专项 AST/实际 import 检查 | 只有标准库、ASS 公开接口和 message_contracts；内部依赖无环；未加载 Django；SRT 错误 reason 均有英文资源。 |
| `git diff --check` | 通过。 |

真实 Chromium 9 个不同场景已通过：

1. `test_srt_local`：BOM/CRLF、量化、非时间顺序、零时长、失败导入保留历史/多选/时间、取消和成功替换基线、SRT 下载/再解析、ASS 下载、离页固定 ASS 备份、IndexedDB 刷新恢复。
2. `test_srt_project`：非法初始 SRT 阻止创建、替换合法文件、默认样式/脚本、真实预览 ready、原项目不提供文件替换、导出不保存、原始时间草稿恢复、显式保存与重载不改样式/source。
3. `test_srt_english_narrow`：英文 360px、IME/键盘焦点、清 Cookie 后真实匿名会话仍可导出、保留原编辑节点、无页面横向溢出、Enter 下载。已检查成功截图并修正 QC 标题在窄屏受按钮挤压的问题。
4. 既有 `test_save_refresh_history`、`test_conflict_preserves_local_edits`、`test_workspace_time_shift_local`、`test_subtitle_replace_local`、`test_workspace_merge_local`、`test_workspace_draft_local` 全部通过。

命令入口在 [docs/testing.md](../testing.md)。成功截图在被忽略的 `frontend/test-results/srt-*/`；未自动批准任何视觉快照。Vitest 的旧磁盘缓存最初未发现新语言 JSON，清除缓存后以常规命令复验全部通过，排查方法已记录在测试文档。

未执行：Firefox/Safari、真实长片源、全部旧 fixture 浏览器脚本、Nginx 代理实测；这些不作为通过项。当前明确限制仍为 UTF-8、10ms 网格及 ASS 支持子集，普通花括号/反斜线与未知标签报错；SRT 无法携带 ASS 外观/元数据。没有待完成的数据模型或架构改动。
