# 字幕纯模型工具

共享的无 React / DOM / HTTP / 存储函数；只向下依赖 contracts，不导入消费者。

- `cue-order.ts`：稳定时间排序，不修改文档 cues 的 ASS 导出顺序。
- `timing.ts`：已应用字幕的非负整数、10ms 网格、10 小时以内和 start < end 契约。原 `media/playback` 重新导出同名接口，保持已有调用方兼容；QC 直接引用纯模型。
- `text-statistics.ts`：可见文本投影及 Unicode 字素统计，供字幕表 CPS 与 QC 复用。投影不判断 ASS 合法性，格式支持范围仍由后端 ass_format 独占。

直接消费者包括 workspace-ui、project-ui、media/playback 和 subtitle-qc。测试位于 workspace-ui/cue-cps.test.ts、media/playback.test.ts 与 subtitle-qc/check-subtitles.test.ts。
