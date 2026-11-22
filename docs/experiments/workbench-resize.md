# 分隔栏联动预览高度验证

2026-11-06，macOS / Chrome 147.0.7727.101 / Node 26。沿用未提交的紧凑顶栏、诊断及字幕查找改动；保留同时进行的用户手册改动。未提交或发布。

## 实现边界

- `ResizableWorkbench` 接收 media / editor / subtitles 三个 ReactNode，只拥有布局，不访问字幕/媒体内部状态。额外高度由用户请求的宽度比例派生，不新增第二份可独立写入的高度状态。
- 默认维持原紧凑高度；向右继续拖动时按视频 16:9 所需高度增高上方区域，字幕区相应缩小。右侧编辑区最低 480px，字幕区最低 144px，达到任一预算即停止放大。
- 高度预算来自整个布局容器，预留字幕最低高度、上下间距、视频控件和边框；不能使用当前上方区域高度作增长上限。边框从计算样式读取，避免 clientHeight 的整数舍入参与高度反馈。
- 左拖收回高度，双击同时复位宽高；键盘方向键 / Shift / Home / End 沿用相同约束。缩小窗口重新约束，窄屏仍用原纵向布局并释放进行中的 Pointer Capture。同文档隐藏/历史恢复保留比例和媒体实例，无新持久化或数据契约。

## 实际检查

- `npm test -- --run`：38 文件 / 348 项通过（包括同时合入的手册路由检查）；尺寸公式新增回归覆盖放大预算、144px 保留、窗口缩小和编辑区宽度限制。既有模块依赖图/diagnostics 叶子检查通过。
- `npm run build`：类型检查及生产构建通过。初次运行遇到同时进行的手册页面引用先于文件生成，文件齐备后完整构建通过，未为此改动手册实现。
- `npm run test:workbench-resize`：真实 Chrome/MP4、实际 App/EditorWorkbench、隔离 HTTP fixture 通过。覆盖右拖实际增大视频与上方高度、左拖回收、480px 编辑区边界、1920×900 达到 144px 字幕最低高度、1440×600 窗口缩小、16:9、双击/键盘、390px 断点释放及同文档历史恢复。字幕正文、时间草稿、选中行、播放位置和 video 实例均保持。
- `npm run test:compact-layout`：默认高度、顶栏提示、设置导航及保留工作区继续通过，1440×900 默认字幕列表仍为 386px。
- `npm run test:video-progress`：真实进度条指针/键盘、播放/时钟/时间轴同步、1440/1000/390px 布局通过。
- `npm run test:subtitle-search`：查找、完整列表、滚动定位、IME、撤销、视频/试听及隐藏工作区保护通过。
- `git diff --check`：通过。

浏览器测试未写开发业务数据库。主回归截图/报告：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-workbench-resize-dJj6fz`；默认布局：`/private/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-compact-layout-yiZtPi`。临时目录可能被系统清理，测试脚本可重跑。

Safari/Firefox 未实测；没有本任务范围外需要自动实施的架构调整。

## 2026-11-23 回收画面两侧留白

默认左栏不再为控制区保留超出16:9画面的宽度，回收宽度全部交给右侧频谱和字幕编辑区。400px仅为期望宽度；高度预算不足时可低于通常的300px下限。拖动状态只保留用户请求的比例，移除画面与列宽差额。未增加模块依赖、控件或持久化字段。

真实 Chrome 147.0.7727.101 的 `test:reference-layout` 通过：1440×600时视频仍为348.44×195.98px，左栏由400px收至348.44px，右栏增加51.56px；控制换为两行，字幕表由194px变160px。1440×540仍保留144px字幕表最低高度，此时视频随剩余高度缩小。另覆盖1440×900、1024×768、390×844、参考展开/收起、长文本、中文/英文及连续微小拖动。截图已检查，无额外横向留白或页面溢出。

`npm run typecheck`、`npm run test -- --run src/workspace-ui/workbench-sizing.test.ts`（8项）及 `npm run test:workbench-resize` 通过；后者检查拖动/键盘/复位、断点、最低高度、字幕草稿和媒体实例保留。浏览器使用隔离HTTP夹具，不写业务数据库。本轮未运行全量回归或Safari/Firefox。

证据位于系统临时目录：`cuerelay-reference-layout-KzdJKU`、`cuerelay-workbench-resize-pYkwQy`；可通过上述脚本重跑。
