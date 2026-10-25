# 实时 ASS 预览执行计划（2026-10-24）

## 当前边界

- EditorWorkbench 的 AssDocument 是唯一字幕状态；文本/Style 引用直接更新文档，时间为独立草稿，G/Enter 才提交。项目显式整份保存与 revision 冲突保护不变。
- Style 定义、PlayRes、Layer/Margins 等仍在 source 模板中，styles 只是名字。没有 Project Style 写接口、自动保存或实时协作传输。不能为预览越过现有重载/冲突保护。
- 复用 project-data.exportAss → ass_format.serialize_ass，预览只发送字幕快照（不持久化），视频始终为本地 blob。无需第二套 ASS parser/serializer。

## 方案

1. 锁定 JASSUB 2.5.23（核对 npm 安装类型和实现，不采用 README 中过时的 dist 路径）。Vite 显式导入 dist/worker/worker.js?worker&url 和 dist/wasm/*.wasm?url。
2. ass-preview 接收 video、当前文档与序列化函数；封装 renderer 生命周期、120ms 合并、取消过期转换、串行最新 Track 替换及暂停强制重绘。React 不在输入时重建实例。
3. workspace-ui 仅派生当前选中行的有效时间草稿；不改文档/savedDocument/revision，不把预览成功当保存成功。
4. 同源内置 Noto Sans SC（OFL），queryFonts=false，不查询系统字体、不访问在线字体。提示原字体替代差异。失败隐藏叠加，保留视频和编辑。
5. 复用 video 帧回调/ResizeObserver，对暂停、seek、Track 替换强制重绘；字幕 canvas 无指针事件。全屏针对包含 video/canvas 的 stage。
6. 增加纯草稿转换、更新顺序/清理单测；真实 libass/WASM、中文多 Style ASS、视频播放/seek/编辑/删除/布局/失败与生命周期浏览器测试；检查构建产物。

## 风险与验收限制

- 当前无协作推送和样式编辑接口；验证采用文档快照变更/显式服务器重载，不实现新的业务协议。
- 服务器序列化意味着预览更新需要 ASS 服务；保留正式导出的验证子集（目前标签仅 b/i/u/s、N/n/h）。不扩展编辑器格式接受范围。
- 旧浏览器缺少 OffscreenCanvas/WASM/Worker 时降级；单线程、WebGL 和字体差异须实测，不承诺全平台一致。
- 整体 Track 更新先保证正确，性能按浏览器数据记录；不引入增量业务副本。

## 执行结果

已完成闭环、样式/全屏/错误与资源清理；前端 255 项、纯格式/HTTP 转换 21 项、dev/生产多线程/生产单线程真实浏览器和既有进度/编辑回归通过。实际结果、上游色彩适配和未覆盖平台见 [验收记录](../experiments/ass-preview.md)。
