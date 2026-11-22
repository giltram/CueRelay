# 本地视频与项目片源恢复

本模块拥有本地视频选择、完整 SHA-256 校验、视频节点及 Object URL 生命周期。不上传视频，不读取账号服务，不保存字幕或播放位置。音频提取/试听见 [audio](audio/README.md)。

`playback.ts` 的 MAX_TIME_MS / validateInterval 下移至纯 `subtitle-model/timing`，本模块继续重导出原接口，供媒体操作与 QC 共享同一时间契约。新增依赖方向为 media/playback → subtitle-model → contracts，无反向依赖。

## 公开接口与职责

- `video-file-access.ts`：`SelectedVideo { file, handle? }` / `InitialVideo { file, handle?, sha256 }` 为显式内存交接契约；`VideoFileHandle` 仅申请 read。`videoStorageKey(actorId, organizationId, projectId, media)` 按账号、组织、项目、SHA-256 和大小隔离；`readVideoHandle` / `rememberVideoHandle` 在 origin 内的 IndexedDB `cuerelay-local-video/handles` 读写句柄，不存视频字节、文件路径或校验通过标记。事务完成才认为写入成功。
- `VideoFilePicker.tsx`：用户点击时优先 `showOpenFilePicker`，取消不改变选择。普通本地工作区、不支持的环境或选择器失败后的再次点击使用 hidden 文件 input。组件卸载/禁用后丢弃迟到选片结果。
- `use-video-source.ts`：唯一拥有 File/固定状态、读取与校验任务、进度、重新授权和本机记录提示。自动恢复和手动导入共用校验；读取/校验结果通过 AbortController 隔离。隐藏、身份/访问失效或卸载取消未完成任务；取消不会自动循环重试，手动导入可立即接管。
- `media-manifest.ts` / `file-hash*.ts`：新建项目检查可播放首帧和合法时长，再以 Worker 分块计算完整 SHA-256；打开已有项目核对大小和完整摘要。播放器 loadedmetadata 继续检查合法时长后才通知 verified。新建同页的 InitialVideo 已完成完整校验，允许复用该次摘要；刷新后的句柄必须重新取 File/算完整摘要，不相信文件名、修改时间或旧摘要。
- `LocalVideoPlayer.tsx`：video 节点、Object URL 创建/释放、元数据/播放错误、进度条与全屏 UI；通过 onFile 发布同一个接受的 File。只有播放器元数据通过后才记住句柄。校验失败不解锁编辑，不改变字幕或服务器基准。

工作区通过 `playbackControls` 提供播放和时钟，通过 `subtitleToggle` 提供字幕开关。播放控制行仅显示上层注入的额外动作和预览字幕开关；时间字号为13px（较窄列为12px），总时长为11px。导入视频入口位于 video-stage 中央，沿用同一 VideoFilePicker 和校验流程；metadata 校验成功进入 locked 后移除按钮及文件 input，校验取消/失败仍保留重试入口，已经固定后的播放错误不解除固定状态。

仅本播放器 stage 全屏时，单击 video 通过显式 `onTogglePlayback` 回调交给工作区切换播放/暂停；全屏按钮不触发此回调，普通画面点击保持原行为。全屏 Space 与左右方向键的过滤由 `playback.ts` 提供，工作区拥有实际播放、5 秒相对定位及试听取消，不在媒体组件中建立第二套播放状态。

## 恢复行为与边界

App 将当前已登录且仍有项目访问权的账号 ID 传入工作区；工作区构造项目专属 key，媒体模块不反查账号或路由。新建项目经 ProjectForm → ProjectsPanel → App → app-workspace → EditorWorkbench 显式传递 SelectedVideo。只有 media 的存储函数执行 IndexedDB 读写，业务 HTTP DTO 不变。

读取句柄前仅 queryPermission；未获授权时显示原位提示和「重新授权视频」。requestPermission 必须在用户点击时同步发起，始终为 read，无写入/目录授权。权限仍被拒绝时保留重新授权和导入入口。文件不存在、设备断开、读取失败、摘要不匹配均回到可手动导入状态；成功的普通 input 导入删除该 key 的旧句柄，避免以后恢复错误文件。本机存储失败不会阻止本次有效视频使用。

只在支持 API 的安全上下文中自动恢复。用户清理网站数据、撤销权限、切换浏览器/设备后可能需要重新导入。记录是本机便利缓存，不能替代项目服务器快照或字幕保存；不跨账号自动复用，不恢复本地工作区视频、未保存字幕、历史、选行或播放位置。恢复后保持暂停。多个标签页独立校验，不共享视频实例或草稿。

依赖：`{project-ui, app-workspace(仅类型), workspace-ui} → media → {contracts, diagnostics, page-ui, React, @noble/hashes}`；media 不反向依赖其调用方。音频和预览仍由工作区通过显式 File/节点组合。

## 验证

- `npm test -- --run` / `npm run typecheck` / `npm run build`。
- `npm run test:video-restore`：Chrome、FFmpeg、Vite 默认 5204（`VIDEO_RESTORE_URL` 可覆盖），隔离 HTTP 夹具，不写开发数据库。使用真实 IndexedDB 和可序列化 OPFS 句柄；系统选片/权限决定用夹具模拟，覆盖跨刷新、重新授权、完整摘要、取消/迟到结果、账号/组织/项目/基准隔离、创建交接、选择器/存储失败及本地工作区行为。
- `npm run test:video-progress`：普通视频选片/播放/进度和布局回归。真实操作系统选片及浏览器持久授权 UI 仍需人工验收。
- `npm run test:fullscreen-playback`：Vite 默认 5173（`FULLSCREEN_PLAYBACK_URL` 可覆盖），真实 Chrome Fullscreen API 和合成视频，隔离 HTTP 夹具。覆盖全屏 Space/鼠标播放暂停、左右键 5 秒跳转、长按/边界、退出全屏及字幕草稿保留。

## 中英文展示边界（2026-11-15）

onError 与资源钩子的 notice 使用 contracts/messages.MessageValue；LocalVideoPlayer 在展示时解析。纯校验/解码/哈希不读取语言，Worker 通过 errorMessage 传递可结构化克隆的 descriptor。语言订阅不进入 File、句柄、Object URL 或 Worker 的生命周期依赖；验证数值与媒体基准不变。完整维护/语言验收流程见 [国际化文档](../../../docs/internationalization.md)。

## 展示组合边界

视频下方的项目参考字幕由上层 EditorWorkbench → ResizableWorkbench.mediaFooter 组合。LocalVideoPlayer 通过通用可选 additionalActions 插槽在预览字幕开关旁展示上层注入的动作；不读取动作业务状态。播放器只拥有 video/进度/播放控制；不导入 reference-subtitles 或读取参考状态。CSS 在媒体列预留 footer 的展开/收起空间，必要时缩小16:9画面，媒体节点和生命周期保持不变。

播放器的 `.video-stage` / `.transport` 是工作区使用的公开布局测量节点：ResizableWorkbench 只读取两者边界和尺寸变化，计算进度/播放控制的实际高度，不读取媒体业务状态。隐藏或全屏导致无法测量正常布局时沿用当前预算。
