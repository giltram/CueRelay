# 本地视频与项目片源恢复

本模块拥有本地视频选择、完整 SHA-256 校验、视频节点及 Object URL 生命周期。不上传视频，不读取账号服务，不保存字幕或播放位置。音频提取/试听见 [audio](audio/README.md)。

`playback.ts` 的 MAX_TIME_MS / validateInterval 下移至纯 `subtitle-model/timing`，本模块继续重导出原接口，供媒体操作与 QC 共享同一时间契约。新增依赖方向为 media/playback → subtitle-model → contracts，无反向依赖。

## 公开接口与职责

- `video-file-access.ts`：`SelectedVideo { file, handle? }` / `InitialVideo { file, handle?, sha256 }` 为显式内存交接契约；`VideoFileHandle` 仅申请 read。`videoStorageKey(actorId, organizationId, projectId, media)` 按账号、组织、项目、SHA-256 和大小隔离；`readVideoHandle` / `rememberVideoHandle` 在 origin 内的 IndexedDB `cuerelay-local-video/handles` 读写句柄，不存视频字节、文件路径或校验通过标记。事务完成才认为写入成功。
- `VideoFilePicker.tsx`：用户点击时优先 `showOpenFilePicker`，取消不改变选择。普通本地工作区、不支持的环境或选择器失败后的再次点击使用 hidden 文件 input。组件卸载/禁用后丢弃迟到选片结果。
- `use-video-source.ts`：唯一拥有 File/固定状态、读取与校验任务、进度、重新授权和本机记录提示。自动恢复和手动导入共用校验；读取/校验结果通过 AbortController 隔离。隐藏、身份/访问失效或卸载取消未完成任务；取消不会自动循环重试，手动导入可立即接管。
- `media-manifest.ts` / `file-hash*.ts`：新建项目检查可播放首帧和合法时长，再以 Worker 分块计算完整 SHA-256；打开已有项目核对大小和完整摘要。播放器 loadedmetadata 继续检查合法时长后才通知 verified。新建同页的 InitialVideo 已完成完整校验，允许复用该次摘要；刷新后的句柄必须重新取 File/算完整摘要，不相信文件名、修改时间或旧摘要。
- `LocalVideoPlayer.tsx`：video 节点、Object URL 创建/释放、元数据/播放错误、进度条与全屏 UI；通过 onFile 发布同一个接受的 File。只有播放器元数据通过后才记住句柄。校验失败不解锁编辑，不改变字幕或服务器基准。

## 恢复行为与边界

App 将当前已登录且仍有项目访问权的账号 ID 传入工作区；工作区构造项目专属 key，媒体模块不反查账号或路由。新建项目经 ProjectForm → ProjectsPanel → App → app-workspace → EditorWorkbench 显式传递 SelectedVideo。只有 media 的存储函数执行 IndexedDB 读写，业务 HTTP DTO 不变。

读取句柄前仅 queryPermission；未获授权时显示原位提示和「重新授权视频」。requestPermission 必须在用户点击时同步发起，始终为 read，无写入/目录授权。权限仍被拒绝时保留重新授权和导入入口。文件不存在、设备断开、读取失败、摘要不匹配均回到可手动导入状态；成功的普通 input 导入删除该 key 的旧句柄，避免以后恢复错误文件。本机存储失败不会阻止本次有效视频使用。

只在支持 API 的安全上下文中自动恢复。用户清理网站数据、撤销权限、切换浏览器/设备后可能需要重新导入。记录是本机便利缓存，不能替代项目服务器快照或字幕保存；不跨账号自动复用，不恢复本地工作区视频、未保存字幕、历史、选行或播放位置。恢复后保持暂停。多个标签页独立校验，不共享视频实例或草稿。

依赖：`{project-ui, app-workspace(仅类型), workspace-ui} → media → {contracts, diagnostics, page-ui, React, @noble/hashes}`；media 不反向依赖其调用方。音频和预览仍由工作区通过显式 File/节点组合。

## 验证

- `npm test -- --run` / `npm run typecheck` / `npm run build`。
- `npm run test:video-restore`：Chrome、FFmpeg、Vite 默认 5204（`VIDEO_RESTORE_URL` 可覆盖），隔离 HTTP 夹具，不写开发数据库。使用真实 IndexedDB 和可序列化 OPFS 句柄；系统选片/权限决定用夹具模拟，覆盖跨刷新、重新授权、完整摘要、取消/迟到结果、账号/组织/项目/基准隔离、创建交接、选择器/存储失败及本地工作区行为。
- `npm run test:video-progress`：普通视频选片/播放/进度和布局回归。真实操作系统选片及浏览器持久授权 UI 仍需人工验收。
