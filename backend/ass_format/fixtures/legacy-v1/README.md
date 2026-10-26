# v1 历史快照

这些固定 JSON 使用提交 `5e02c2dea8816c7efa04dc63071512b9667f67d6` 的 `ass_format/codec.py` 生成，均经该版本 parse_ass / serialize_ass 验证。测试运行不依赖 Git 历史或当前 empty_document。

- valid：v1 受支持快照，迁移保留 source/Cue 身份与语义。
- leading-zero-playres：v1 接受 `0640`，v2 拒绝非规范 PlayRes。
- long-style-name：v1 接受 101 字符名称，v2 上限 100。
- duplicate-playres：v1 接受两个相同 PlayResX，v2 拒绝重复记录。

后三项保持显式拒绝，不自动修改 source、不截断名称。维护前由 check_style_migration 列出，人工导出、调整并验证后重试；异常迁移必须整体回滚。夹具只含合成数据。
