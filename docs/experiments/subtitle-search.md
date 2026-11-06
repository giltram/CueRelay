# 字幕文本查找与定位验证（2026-11-06）

范围与模块契约见 [workspace-ui](../../frontend/src/workspace-ui/README.md#字幕文本查找)，设计分工见 [实施计划](../plans/subtitle-search.md)。本次无后端、DTO、revision、权限、保存协议或编辑历史模型变更，未创建 git commit。

## 实际执行

在 `frontend` 中执行：

| 检查 | 结果 |
| --- | --- |
| `npm test -- --run` | 37 文件、335 测试通过（含 8 个查找纯函数测试） |
| `npm test -- --run src/workspace-ui/cue-search.test.ts` | 最后优化重叠高亮映射后，8 测试再次通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | TypeScript 与 Vite 生产构建通过 |
| `npm run test:subtitle-search` | Chrome 147.0.7727.101，通过，无 pageerror、无意外 API 请求 |
| `npm run test:cue-table` | 通过，选行/暂停/定位/无媒体/列宽/键盘/指针捕获回归无错误 |
| `npm run test:subtitle-focus` | 通过，Tab/Ctrl+Space 设置、焦点、试听、IME、弹窗和导入忙碌边界无错误 |
| `git diff --check` | 通过 |

另用一次性 Python 脚本遍历前端 136 个 TypeScript 文件的相对静态导入，DFS 未发现循环；手工检查新依赖只流向 workspace-ui 内的查找职责、subtitle-model、contracts、React 和 DOM，没有新增后端或编辑历史依赖。

本地 Vite 与 Chrome 启动最初受执行沙箱限制；允许执行后完成上述浏览器测试。测试使用隔离 HTTP fixture 和 FFmpeg 生成的 8 秒本地视频，没有写入开发数据库。ASS 预览显式返回不可用 fixture，不把本次测试当作真实 ASS 渲染器验收。

## 已覆盖的行为

纯函数测试：中文、英文大小写、普通元字符、Unicode UTF-16 位置、同一行多次和重叠命中；支持标签/跨标签文字及三种空白转义；未完成/非法草稿保持字面文本；空/无匹配、字面空格；稳定时间顺序；首次包含当前行、非命中选行、无选择、双向循环、单结果、cue ID 重排、正文修改/删除后重新派生。

真实浏览器检查：

- 完整 32 行、保留原始文本/行号；匹配文字安全高亮、当前行区分；`<img ...>` 原文不生成元素。
- 输入关键词前后对比选择、非法未完成入点草稿、出点草稿、完整正文、视频位置/暂停状态、试听状态、列表滚动值，均不变化；无新增请求。
- 无视频时通过 Enter、Shift+Enter、鼠标按钮、按钮原生 Enter 导航；首次包含当前行/从非命中行开始，前后循环，只滚动列表并避开 sticky 表头，焦点持续回到查找框。
- compositionstart/end、isComposing、229、repeat，以及 Chrome DevTools Protocol 的真实浏览器 composition 事件；候选确认 Enter 不导航。查找框内 q/w/g/空格/Enter 不提交或试听。
- 初始 body 焦点、字幕 textarea 内 Ctrl/Cmd+F 均可打开；再次按快捷键聚焦并全选，甚至个人 split-text 配置为 Ctrl/Cmd+F 也不会穿透到拆分。
- Esc、再次点击「查找」、查找按钮原生 Enter 都移除高亮并返回工作区焦点，保留最后的选行/视频位置；主容器点击逻辑不会抢走查找焦点。
- 未保存文本编辑、删除及撤销实时更新结果；删除后的第一次撤销直接恢复删除，没有插入查找历史步骤。
- 视频暂停时输入保留其位置，播放时输入保持播放；主动跳转暂停并定位入点、按原选行规则处理草稿。独立音频试听在输入期间保持播放，主动导航取消试听。
- 样式弹窗及其他页面不阻止浏览器查找；工作区隐藏/恢复保留自己的查找状态。
- 未验证媒体的项目及已归档只读项目，无视频/无选行时可以从首个或末个结果开始查找；项目保存按钮保持未修改状态。

最终 Chrome 截图已实际打开检查：查找条位于标题栏下方，当前命中使用既有深绿色，其他命中使用既有浅色，文本可读，无新增结果面板。

## 产物与限制

本机临时报告和截图目录（未加入仓库）：

- 查找：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-subtitle-search-ApW1Dp`
- 字幕列表：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-cue-table-TqLUTw`
- 字幕焦点：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-subtitle-focus-qrUETE`

本次未执行 Safari/Firefox、人工操作系统输入法候选窗口或读屏软件验收；IME 验证来自事件保护测试及 Chrome CDP。未执行真实片源制作验收或最大规模字幕性能基准。未发现需要在本任务外继续实施的架构调整。


## 查找条收紧与按钮切换（2026-11-06）

移除查找条内关闭按钮；标题栏「查找」使用 aria-pressed 复用现有选中配色，并切换展开/收起。Ctrl/Cmd+F 在已展开时仍聚焦和全选关键词，Esc 仍关闭。输入框和前后按钮压到 28px，条内上下间距缩减，整条高 32px；控件焦点轮廓置于内侧，避免紧凑间距裁掉焦点提示。

本次实际执行 `npm run typecheck`、`npm run build`、`npm run test:subtitle-search` 和 `git diff --check`，均通过。Chrome 147.0.7727.101 回归新增检查：没有关闭按钮、查找按钮按压状态、鼠标及原生 Enter 切换、关闭焦点、输入框/条高度，以及展开占用的高度完全从字幕滚动区扣除、收起时恢复。最终截图已打开检查。

本次报告/截图目录：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-subtitle-search-jCuYNC`。复用已运行的本地 Vite，没有重启用户服务。没有新增模块依赖或修改匹配/定位规则，未创建 git commit。浏览器覆盖限制同上。

## 重复选择当前行保留时间草稿（2026-11-07）

`EditorWorkbench.selectCue` 按当前状态的 cue ID 判断是否换行；同一行直接保留原始编辑状态，只有换行才调用 `withSelection` 载入目标行的已提交时间。仍经原有 navigate 结束编辑分组、取消试听，原视频暂停/定位行为保留；不改变提交、保存和历史模型，没有新增导入或模块依赖。

先增加浏览器回归，在修复前确认失败：无视频时再次点击当前行，未完成入点 `0:` 被覆盖为 `0:00:01.60`。修复后实际执行并通过：

- `npm run test:subtitle-search`：Chrome 147.0.7727.101，行号/正文重复点击保留原始草稿；查找命中当前行同样保留，真正换行/切回恢复已提交时间。G 创建的新行经频谱鼠标设置 3.50–5.60 秒后重复点击仍保留，表格在 G 前仍为默认 3.30–5.30 秒，G 后才写回并选下一行。原查找、视频定位及试听取消检查通过，pageerror 和意外 API 请求均为 0。
- `npm run typecheck` 通过。
- `npm run test -- --run src/workspace-ui/edit-history.test.ts src/workspace-ui/commit-timing.test.ts src/workspace-ui/cue-search.test.ts`：3 文件、32 测试通过。
- `git diff --check` 通过。

报告目录：`/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-subtitle-search-lejcpl`。测试复用已有 Vite、隔离 HTTP fixture 和合成媒体，不写开发数据库。浏览器启动需要沙箱外执行，获准后完成；跨浏览器/真实片源限制同上。未创建 git commit。
