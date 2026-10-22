# 音频功能后续开发约定

2026-10-23 用户要求：后续音频开发使用独立 `audio` 分支和 worktree，不影响 `main`；每完成一部分功能，测试通过后提交并 push，方便回退。

- 基线：`2001dcb`（`add local audio extraction module`），阶段 A 已完成，且此提交已经存在于 main。
- 本分支从该基线创建，不包含原 main 工作区尚未提交的用户系统改动。
- 后续修改只在本分支对应的 worktree 内进行；开始工作前检查 `git status --short --branch` 和 `git worktree list`，确认当前位置。
- 按可独立验证的功能分段提交；执行相关测试，更新模块契约和实验记录，再 commit / push 到 `origin/audio`。提交说明使用简短、小写开头的英文。
- 不自动合并到 main，不 force push，不将其他任务的改动混入音频提交。回退已推送的功能时优先使用 `git revert` 保留历史。
- 2026-10-23 用户已授权连续完成 B–D，遇到重大阻碍才停止。

## B–D 执行计划

1. B：将同一 File 接入独立音频 Worker；2 秒 PCM 分段、有字节上限的 LRU 缓存、波形峰值；替换原占位，支持共享视窗的缩放 / 平移 / video 播放头。相关单元测试、构建、浏览器验证后提交并 push。
2. C：在同一 Worker / PCM 缓存上加入 FFT/STFT 频谱和模式切换；两种显示使用同一坐标。测试已知频率和时间精度后提交并 push。
3. D：字幕边界与既有草稿操作整合、快速定位与换片取消、错误 / 资源释放、生产构建浏览器回归；同步架构和实测记录后提交并 push。

解码 / 分析归 media/audio；时间坐标、canvas 渲染和交互归 workspace-ui/audio-timeline。不得增加第二播放器或服务器媒体处理。保留现有成功选片后的固定片源限制，测试用刷新 / 卸载验证换片生命周期。

阶段 A 的实现与测试范围见 [本地音频实验记录](local-audio.md)，模块接口见 [audio README](../../frontend/src/media/audio/README.md)。
