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
