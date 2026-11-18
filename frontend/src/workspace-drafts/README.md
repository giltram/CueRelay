# 本机工作区草稿

IndexedDB 中的草稿只供恢复编辑。当前字幕仍由 `workspace-ui/use-edit-history` 管理，已提交项目仍以服务器快照为准。

- `model.ts` 定义版本化草稿。记录包含账号/组织/项目范围、标签页 ID、记录 ID、写入代次和时间、项目基准 revision（本地工作区为 null）、现有 ASS DTO、可选未应用时间及对应行 ID。样式、脚本设置、原始 ASS 模板和行元数据都来自原 DTO。媒体、播放状态、多选和撤销栈留在原模块。
- `tab.ts` 用 sessionStorage 保留刷新时的随机标签页 ID，用同源 Web Locks 对 ID 排他占用到文档关闭。复制标签页带入的旧 ID 已被占用时生成新 ID。此锁只保护本机草稿归属，与项目权限或服务器写入无关。
- `store.ts` 拥有数据库 `cuerelay-workspace-drafts` 和事务。记录以独立 ID 为主键，按范围查询。已关闭标签页的草稿可以明确选择恢复或放弃。操作时重新获取来源 ID 的锁并在一笔事务里检查范围、归属和写入代次。恢复移动记录归属，放弃删除精确记录。仍占用来源 ID 的标签页的草稿由该标签页管理。
- `autosave.ts` 只写工作台正在编辑的一个记录，尾部延迟 750ms，连续输入最多等待 3 秒。事务按创建顺序执行，代次检查防止旧回执覆盖新状态。确认提交后清理当前已持久化的版本，仍有新输入则按新 revision 写入。隐藏页面、离开页面和显式项目保存开始前会尽力提交待写入快照。失败保留内存编辑，也保留最后一次成功的磁盘记录。

依赖为 `{main, App, workspace-ui} → workspace-drafts → contracts/subtitles + 浏览器 API`。main 在账号或项目请求前认领标签页 ID。工作台 `use-workspace-draft` 负责 React 生命周期和读取候选，`WorkspaceDraftNotice` 负责双语状态及操作。项目恢复前由 app-workspace 重新读取服务器 revision，工作台同时检查草稿和当前保存基准。冲突草稿继续可导出，选用已加载版本仅收起入口。App 原有明确放弃流程在切换成功后删除离开的活跃记录。

浏览器清理站点数据、存储权限、配额和异常退出会影响可恢复范围。崩溃前尚未完成的事务可能丢失。草稿目前保留到明确放弃或确认提交，不进行基于时间的自动清理。ASS 导出下载不会清除草稿。回归入口见 `autosave.test.ts` 和 `frontend/regression/workspace-drafts.spec.mjs`。
