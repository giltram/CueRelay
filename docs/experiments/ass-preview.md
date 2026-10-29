# 实时 ASS 预览验证（2026-10-24）

实现边界与公共接口见 [预览模块](../../frontend/src/ass-preview/README.md)，实施计划见 [执行计划](../plans/ass-preview.md)。不修改后端业务、项目 revision、显式保存/重载或快捷键语义。

## 实际环境和检查

macOS / Node 26.4.0 / Chrome 147.0.7727.101；依赖 JASSUB 固定 2.5.23。浏览器测试使用实际 Chrome、FFmpeg 生成的 12 秒 640×480 H.264/AAC 视频和仓库自编 [preview.ass](../../frontend/browser-tests/fixtures/preview.ass)。身份/项目读取为无写库 HTTP 夹具；ASS 导入/导出走本机真实 Django 转换接口，渲染使用真实 libass Worker/WASM，未 Mock 引擎。

| 实际执行 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test -- --run` | 25 文件 / 255 项通过（新增预览 9 项） |
| `npm run build` | 通过，包含独立 Worker、两份 WASM 和同源 Noto Sans SC |
| `DJANGO_SECRET_KEY=... DJANGO_DEBUG=1 .venv/bin/python backend/manage.py test ass_format http_api.tests --noinput` | 21 项通过，无数据库依赖 |
| 同环境 `backend/manage.py check` | 无问题 |
| `npm run test:ass-preview`，Vite dev 5173 | 通过 |
| `ASS_PREVIEW_URL=http://127.0.0.1:5184 npm run test:ass-preview`，生产 preview | 通过，crossOriginIsolated=true |
| 同上加 `ASS_PREVIEW_SINGLE_THREAD=1` | 通过，crossOriginIsolated=false，实际单线程路径 |
| `npm run test:video-progress` | 通过：指针/键盘拖动、试听取消、时钟/时间轴同步，1440/1000/390 布局 |
| `EDITING_URL=http://127.0.0.1:5173/workspace/local npm run test:editing-operations` | 通过：原鼠标边界、设置、IME、快捷键、文本拆分、项目 revision 链/冲突保留及重载 |
| 当前 TS/TSX 相对导入图检查 | 90 文件 / 208 边，无环；media/ass-preview 不依赖业务 UI、app-workspace 或 project-data |
| `git diff --check` | 通过 |

第一次宽泛的 `test ass_format http_api` 同时选择了与本次无关的账号数据库测试，受限环境无法连接 PostgreSQL 建立测试库，没有完成；上表改为确切的 `http_api.tests` 转换契约，无数据库运行。没有声称执行全部后端数据库回归。编辑操作脚本要求完整工作区 URL，最初使用根 URL 的调用已终止并以正确地址重跑通过。

## 浏览器覆盖和视觉检查

- 初始中文、`\N` 换行、文本逗号、b/i 标签、两个 Style 同时在画面叠加；缺失的 `Missing Preview Font` 使用内置字体，渲染不失败。
- 暂停时编辑文本，不更换 canvas；修改有效时间草稿先反映在画面，表格/文档原时间保持，G 才提交。
- 增加行、Style 引用切换、删除当前行/删空、播放跨越无字幕区间和暂停 Seek：旧字幕正确消失/返回。
- 通过既有导入入口替换 source 中 Style 定义（32 → 60 号、白 → 红）后，在同一个 canvas 更新，未建立 Style 副本或新的格式转换器。
- 对快速连续输入，检查 canvas 同一性、最后文本、转换数；主动延迟旧转换响应并在新版显示后释放旧响应，截图 hash 保持最新。dev 约 178ms、生产多线程约 174ms、生产单线程约 179ms；每轮连续输入均为 1 次合并转换。这是本机一次小样本的最后输入到截图采样延迟，包含测试开销，非 p95 或大项目 SLA。
- 1440/1000/390 视窗：实际 4:3 视频在 16:9 stage 内居中，canvas 比例与 letterboxing 对齐；全屏 stage 同时包含 video/canvas，退出恢复。
- 故意输入不完整 `{`：真实导出返回 422，隐藏旧字幕并显示预览错误；修复后复用原引擎。
- 主动阻断 WASM：显示错误、移除 canvas、视频可继续 Seek、关闭/开启重试成功。上游 Worker 在此注入路径产生一次 `TypeError: Failed to fetch`，明确记录在 `expectedWorkerFailures`；正常流程 `errors=[]`。不是把故障注入异常当正常流程无异常。
- 反复启停、3 次项目/视频重新进入与远端快照显式重载：每个活动工作区只有一个 canvas，Worker 数回到首次加载水平。多线程为 10（包含 8 个 JASSUB pthread 和音频 Worker），单线程为 2；没有把 pthread 数量误判为多个渲染实例。该测试检查有界活动资源，不是浏览器长期 heap 泄漏证明。
- 整个浏览器请求审计 `outside=[]`，没有外部字体/资源请求；非 GET 请求仅允许字幕 ASS 转换，没有视频、音频、帧或字体上传。

已通过 `view_image` 实际检查中文重叠、白/红两种字号样式、描边/阴影及全屏截图。生产多线程截图/JSON 位于本机临时目录 `cuerelay-ass-preview-A85ydV`，单线程为 `cuerelay-ass-preview-NcGMF4`；脚本每次会打印完整路径，不向仓库提交生成的视频。dev 最终记录为 `cuerelay-ass-preview-zwAxJr`。

视觉检查发现并修正两项实际问题：提示原本覆盖了上方字幕，现移到画面外；JASSUB 的自动 BT709 → BT601 矩阵会令白字偏绿，适配层禁用该转换，加入中性白像素检查。截图同时验证黄字和修改 Style 后的红字。

## 复现

按根 README 启动 Django 和 Vite，安装系统 Chrome/FFmpeg，仓库 `.venv` 含格式依赖：

```sh
cd frontend
npm run test:ass-preview
npm run build
npm run preview -- --port 5184
# 另一终端
ASS_PREVIEW_URL=http://127.0.0.1:5184 npm run test:ass-preview
ASS_PREVIEW_URL=http://127.0.0.1:5184 ASS_PREVIEW_SINGLE_THREAD=1 npm run test:ass-preview
```

浏览器测试中的 `unavailableAssPreview` 只供其他 UI 专项的简化 DTO/无 ASS 服务夹具使用，显式返回 503；这些专项测试不宣称验证了渲染。本测试不使用该降级夹具。

## 2026-10-29 试听边界闪烁回归

25fps 合成视频，字幕时间草稿为 1.23–1.87s，两端均不对齐视频帧。修复前新增的浏览器用例在暂停定位 1.23s 后检测不到字幕；此前时序探针也记录到试听结束的渲染时间为 1.88 → 1.87 → 1.84s，较早帧回调恢复了已结束字幕。`PreviewJassub.manualRender` 在暂停 / seeking 时统一使用 `video.currentTime`，正常播放保留帧 PTS。

执行结果：

- `npx vitest run`：27 个文件、272 项通过，其中新增 3 项适配层时间基准测试。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过。
- `npm run test:ass-preview` 及 `ASS_PREVIEW_SINGLE_THREAD=1 npm run test:ass-preview`：Chrome 147.0.7727.101，多线程 / 单线程均通过。每轮连续三次定位非帧对齐入点并按 Space 试听，入点字幕可见、出点暂停后多次像素采样无字幕；原有编辑、全屏、故障恢复及项目重载检查通过，正常页面 `errors=[]`。
- 开发服务器的单线程运行记录了 Chrome 对 Vite 热更新 WebSocket 的本地网络访问拦截，未影响字幕断言；上述运行均使用开发服务器，本次构建只验证生成成功，没有另行运行生产浏览器回归。

修复仅位于现有第三方适配层，未增加模块依赖或改变字幕 / 媒体的所有权。Safari、Firefox 及真实片源仍未在本次验证。

独立音频试听接入后的本轮回归：Space 只输出音频，视频 / ASS 保留 1.23s 画面；随后显式定位 1.87s 检查旧帧不能恢复字幕。既有 currentTime 渲染修复不变。本轮 Chrome 多线程专项通过，细节见 [试听记录](audio-audition.md)；此前单线程结果是上次修复记录，本轮未重复单线程专项。

## 已知限制和后续

- 现有仓库尚无实时协作推送、自动保存和 Project Style 写接口；本次没有扩展协议。远端已提交快照经现有明确重载接受后更新。未来事件应用必须写入同一个 EditorWorkbench 文档；不能由预览偷偷覆盖本地稿。
- 预览更新依赖无持久化 ASS 转换服务；字体和渲染全部本地。服务离线或不支持的标签仍显示错误并保留编辑稿。`\pos` 等不在现有导入子集内，未扩大格式公共契约。
- 内置 Regular 中文字体约 8.3MB，缺少原字体/其他字重时可能改变字形、换行和排版；不保证所有 Unicode 字符。不实现上传/扫描/字体库。
- 只有本机 Chrome/合成片已实测，Safari/Firefox、HDR、复杂片源、5000 行极限、长期内存与同字体桌面渲染器逐像素对照仍待后续验证。
- 保持 ASS 原始 RGB，未采用该版本有缺陷的自动色彩 mangling；历史 VSFilter 色彩兼容不作承诺。JASSUB 的 `_worker` 清理及 `_updateColorSpace` 适配受固定版本约束，升级需重新检查。
- JASSUB 整个发行包和传递依赖不能概括为 MIT：包声明含 LGPL/FTL 等，rvfc-polyfill 1.0.8 声明 GPL-3.0，详见此前 [依赖调查](media-ass.md#环境与依赖)。内置字体的 OFL 与来源/hash 已随文件保存；正式分发应保留各依赖的许可和源代码义务。

没有发现需要在本次范围内继续拆分的架构问题；未来 Style 编辑/协作传输属于现有公共文档入口的上层消费者，不应挪入渲染适配器。
