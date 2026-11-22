# 字幕纯模型工具

共享的无 React / DOM / HTTP / 存储函数；只向下依赖 contracts，不导入消费者。

- `cue-order.ts`：稳定时间排序，不修改文档 cues 的 ASS 导出顺序。
- `cue-merge.ts`：`mergeCueLines(document, ids)` 按 ASS 事件顺序合并至少两个有效 ID，保留首条的入点、身份、样式和 ASS 元数据，出点取最大值，正文以空格拼接。验证输入时间并返回不可变候选文档和幸存行；调用者通过原 ASS 序列化器预检完整文档后才写入历史。回归见 `cue-merge.test.ts`。
- `style-snapshot.ts`：withStyleSnapshot 只替换权威 source/styles/script，保留 cues 引用；由 project-data 保存合并和 workspace-ui 历史适配共用。是否允许合并由保存策略校验，纯函数不访问服务器或历史。
- `snapshot-equality.ts`：JSON 快照内容比较忽略对象键序，保留数组顺序、字段存在性与标量类型；避免 PostgreSQL JSONB 对象键序变化导致保存策略误报冲突。
- `timing.ts`：已应用字幕的非负整数、10ms 网格、10 小时以内和 start ≤ end 契约。零时长行允许编辑和持久化，不自动拉长；视频帧与拆分的正时长要求由各操作负责。原 `media/playback` 重新导出同名接口，保持已有调用方兼容；QC 直接引用纯模型。
- `time-shift.ts`：`shiftCueTimes(document, targets, offsetMs)` 接受明确的全文标记或字幕 ID 集合，以及带方向的毫秒偏移。复用 `validateInterval` 检查所有目标行的结果，失败只返回原因。成功保留文档事件顺序、时长和字幕元数据，未修改行复用原引用。零偏移或无目标时返回原文档。零时长和上下界测试见 `time-shift.test.ts`。
- `ass-text.ts`：查找用词法投影，仅识别完整 override 块，不验证数值范围、整行相互作用或完整 ASS。不能作为导入/保存/导出合法性依据；后端 ass_format 仍独占正式规则。
- `text-statistics.ts`：可见文本投影及 Unicode 字素统计，供字幕表 CPS 与 QC 复用。投影不判断 ASS 合法性，格式支持范围仍由后端 ass_format 独占。

直接消费者包括 workspace-ui、project-ui、project-data、media/playback 和 subtitle-qc。测试位于 workspace-ui/cue-cps.test.ts、media/playback.test.ts 与 subtitle-qc/check-subtitles.test.ts。
