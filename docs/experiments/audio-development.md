# 音频功能后续开发约定

2026-10-23 用户要求：后续音频开发使用独立 `audio` 分支和 worktree，不影响 `main`；每完成一部分功能，测试通过后提交并 push，方便回退。

- 基线：`2001dcb`（`add local audio extraction module`），阶段 A 已完成，且此提交已经存在于 main。
- 本分支从该基线创建，不包含原 main 工作区尚未提交的用户系统改动。
- 后续修改只在本分支对应的 worktree 内进行；开始工作前检查 `git status --short --branch` 和 `git worktree list`，确认当前位置。
- 按可独立验证的功能分段提交；执行相关测试，更新模块契约和实验记录，再 commit / push 到 `origin/audio`。提交说明使用简短、小写开头的英文。
- 不自动合并到 main，不 force push，不将其他任务的改动混入音频提交。回退已推送的功能时优先使用 `git revert` 保留历史。
- 本次只建立后续开发环境，没有开始阶段 B。后续功能范围以用户下一步指令为准。

阶段 A 的实现与测试范围见 [本地音频实验记录](local-audio.md)，模块接口见 [audio README](../../frontend/src/media/audio/README.md)。
