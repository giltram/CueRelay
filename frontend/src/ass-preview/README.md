# ASS 实时预览

## 所有权与接口

`useAssPreview(video, mediaFile, document, serialize, visible)` 是 workspace-ui 的公开组合接口。返回字幕开关、加载/错误状态；不修改字幕、选择、时间草稿、revision 或保存状态。`media` 通过 video/File 输出与 `status` ReactNode 插槽组合播放器，不依赖预览模块。

- `workspace-ui/preview-document.ts` 仅把当前选中行的有效时间草稿投影为临时快照。文本和 Style 引用原本就在 EditorWorkbench.document 中；未提交时间不会因此写回、保存或导出。无效/未完成的时间输入沿用文档时间并提示。
- Style 定义与 PlayRes 的权威是 v2 `AssDocument.styles` / `script`；Cue 用 style_id 引用，source 仅保存元数据与原始锚点。任何正常文档替换（导入、项目重载、未来协作入口）都走相同的渲染路径。没有第二份可写字幕 store。
- `serialize` 显式注入既有 `project-data.exportAss`。预览与导出都使用 `/api/ass/export` → `ass_format.serialize_ass`，不另写 ASS parser/serializer。HTTP 只包含字幕快照，无持久化副作用；File、视频/音频/帧、字体都不进入 DTO。
- `preview-session.ts` 拥有 120ms 合并、AbortController 与单调代次、最新待处理 Track 和串行 Worker 更新。忽略不遵循 AbortSignal 的过期响应；等待初始化/上次 setTrack 时只保留最新结果。相同序列化输出不重复 setTrack。转换失败隐藏旧字幕，下一次有效编辑可恢复同一个引擎。
- `jassub-renderer.ts` 是唯一第三方适配点。JASSUB 2.5.23 / libass WASM 在 Worker 内渲染；等待 ready 后再连接既有 video，播放靠 requestVideoFrameCallback；暂停编辑、seeked、loadeddata、pause 后通过 manualRender 强制重绘。暂停或定位期间所有渲染请求统一使用 video.currentTime，避免稍后到达的帧时间戳越过字幕边界、覆盖精确定位的画面；正常播放继续使用帧时间。JASSUB ResizeObserver 保持 object-fit:contain 下画面尺寸；全屏针对同时包含 video/canvas 的 stage，并主动 resize/repaint。canvas 不接收指针事件。

## 生命周期与资源

File/video 身份与开关控制会话生命周期；输入字幕只更新 Track，不新建引擎。隐藏字幕会释放渲染器，重新开启按最新文档初始化；导航隐藏保留的工作区仅隐藏 canvas，继续保留实例。项目重载/更换和组件卸载销毁会话、取消转换、清理事件和 canvas。初始化超时 20 秒，错误不阻断播放或编辑，关闭后重新开启可重试。

2.5.23 有三个局部、受版本约束的适配：

1. 官方 destroy 等待 ready / releaseProxy；Worker 初始化或通信失败时可能永远未完成。适配层仅在这里读取 `_worker` 注册 error/messageerror，并给 destroy 250ms 宽限后强制 terminate，防止失败的 Worker 残留。正常释放仍优先使用公开 destroy。
2. 该版本自动 BT709 → BT601 的 WebGL 矩阵会给中性白色引入色偏。`PreviewJassub` 禁用 `_updateColorSpace` 自动转换，保留脚本 RGB；不改 source、字幕颜色或 libass 引擎。浏览器检查包含中性白/黄/红像素，升级引擎时重新评估此适配。HDR/VSFilter 历史色彩 mangling 与不同桌面渲染器的逐像素一致性未承诺。
3. `PreviewJassub.manualRender` 在暂停 / seeking 时以当前媒体时间替换帧 PTS。例如 25fps 视频定位到 1.87s 时可能在 seeked 重绘后再收到 1.84s 帧；字幕出点为 1.87s 时，原回调会错误恢复已经结束的字幕。此适配只选择渲染时间，不修改视频位置、试听出点或字幕数据。升级时须保留非帧对齐入 / 出点回归。

## 字体与兼容性

内置 Noto Sans SC Regular（约 8.3MB，SIL OFL 1.1）从应用同源加载，详情见 [fonts](fonts/README.md)。字体先显式检查下载结果，再作为字节传给 JASSUB；不静默继续无字体渲染。`queryFonts:false`，不扫描/上传系统字体、不请求 Google Fonts 或 CDN。未提供的字体由内置字体回退；UI 始终提示字体替代差异。只有一个 Regular 字重，粗体/斜体由引擎合成；繁体/日文/罕见字符和特殊符号未保证完整覆盖。本次不实现字体管理。

Vite 使用安装包的实际路径 `dist/worker/worker.js?worker&url`、`dist/wasm/*.wasm?url`，不照抄 README 的旧 dist 路径。所有资源打包到 assets。需要 Worker、WASM、OffscreenCanvas 和可用的画布；保留现有 COOP/COEP/CSP，缺少跨源隔离时 JASSUB 使用单线程。生产服务需正确返回 JavaScript、`application/wasm` 与 OTF MIME；资源 404 不得返回 SPA HTML。

当前编辑器仅允许 b/i/u/s 布尔标签与 N/n/h 转义；Style 字体/字号/颜色/描边/阴影/对齐/边距可按原模板渲染。`\pos` 等尚未进入原有导入契约，仍被保护性拒绝；不因引擎支持而绕过正式导出校验。ASS 服务不可用或文本暂时无效时显示预览错误；字幕草稿仍保留，视频继续工作。

目前没有自动保存或 WS/协作事件应用；具名 Project Style 写接口已实现，提交后正常替换现有文档触发预览。不新增预览专用轮询。其他成员修改经现有显式项目重载接受后自动渲染，新实时同步入口应同样只替换现有文档。

## 测试

- `preview-session.test.ts`：合并、同实例、乱序、初始化/Track 阻塞、无效编辑恢复、卸载。
- `jassub-renderer.test.ts`：暂停后较早帧回调、前后定位、播放中定位和恢复正常播放的渲染时间选择。
- `workspace-ui/preview-document.test.ts`：时间投影、无效草稿、元数据和输入不变。
- `npm run test:ass-preview`：真实 Chrome、合成 4:3 视频、实际后端 codec 和真实 JASSUB/WASM；中文、换行/标签、多 Style、重叠、样式定义变更、编辑、时间、创建删除、乱序、快速输入、播放/seek、非帧对齐入点定位及空格试听结束后的字幕像素、resize/全屏、字体替代、WASM 失败恢复、项目重载和切换。
- 需要已启动 Vite/Django、Chrome、FFmpeg 和仓库 `.venv`。身份/项目 API 是无写库夹具，ASS 转换走真实 HTTP；测试不验证尚未实现的协作协议。
- `ASS_PREVIEW_URL` 可指向构建 preview；`ASS_PREVIEW_SINGLE_THREAD=1` 在浏览器测试中移除导航响应的隔离头，实际验证单线程路径。截图和 JSON 输出到系统临时目录。

实际执行记录见 [docs/experiments/ass-preview.md](../../../../docs/experiments/ass-preview.md)。

## 样式管理效果预览

`StyleSamplePreview(document)` 复用 useAssPreview / PreviewSession / createJassubRenderer 和同一后端序列化器。在本地黑色 Canvas 上 captureStream(1)，接给独立 muted video 提供渲染尺寸/帧回调；不需要选片、摄像头权限、字体上传或第二个 ASS 引擎。hook 的媒体身份可为 File 或此 MediaStream。关闭面板时销毁引擎、停止全部流轨道、解除 video.srcObject。每次字段变化只更新 Track；临时样本文档由 style-ui 的纯投影生成，不进入编辑器/保存状态。

`browser-tests/style-management.mjs` 使用真实 JASSUB/WASM、截图像素与 DOM 身份检查，验证红色样本确实渲染、输入时复用 canvas、关闭后恢复项目编辑、窄屏布局和导出。样本基于 640×360 底图，字体替代与最终播放尺寸差异仍须人工视觉 QC。

普通工作区选区试听现为独立 Web Audio 音频，ASS 仍只跟随 video.currentTime / 视频帧；试听保持 video 静止，不把音频播放头传给 JASSUB。暂停 / seeking 的 currentTime 适配继续保留。`browser-tests/ass-preview.mjs` 分别检查试听时画面不变，以及手动定位到非帧对齐出点后旧回调不能恢复字幕。
