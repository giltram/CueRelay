# 字幕质量检查

`check-subtitles.ts` 是无 React、DOM、HTTP、存储依赖的纯检查入口：

```ts
checkSubtitles(document, { phase: 'editing' | 'export', videoDurationMs, thresholds, formatIssues })
```

仅依赖 `contracts` 与 `subtitle-model`，不依赖工作区或媒体。输入为当前已应用的不可变内存文档；输出为 `{id, type, cueIds, severity, message, measurements}` 数组。问题 ID 由规则类型和字幕 ID 生成，不含易变化的行号或测量值；文档级格式问题允许 cueIds 为空。无内容修改、自动修复、保存或后台计算。

## 规则和默认值

| 类型 | 判定 | 严重度 |
| --- | --- | --- |
| invalid-time | 复用 subtitle-model/timing 的整数/10ms/范围/start < end 契约 | error |
| duration-short / duration-long | 时长 <500ms 或 >7000ms | warning |
| overlap | 时间排序中相邻且同样式，重叠 >100ms 且占较短行 >25% | warning |
| outside-video | 出点超过已知有限正片长 | warning |
| empty-text | 去格式和空白后无可见正文；纯标点不算空 | editing info / export warning |
| high-cps | 精确 CPS >20，消息保留一位小数 | warning |
| text-long | 计数字符 >80 | warning |
| repeated-text | 同样式相邻非空可见正文相同，间隔 0–1000ms | warning |
| missing-style | style_id 不在当前样式定义中 | error |
| unsupported-ass | 由唯一后端 codec 检查，不在前端复制标签白名单 | error |

阈值集中在 `defaultQcThresholds`，可通过纯函数参数覆盖，没有用户规则设置页。CPS 和正文长度复用 `subtitle-model/text-statistics`：按 Unicode 字素计数，忽略 ASS 块、空白、N/n/h 转义和标点；不把 UTF-16 长度当作中文字符数。表格 CPS 继续向下取整显示，QC 比较保留实际精度。可见文本投影用于统计，不等于格式校验。

排序不修改原始 ASS 事件顺序；相邻比较为线性扫描，排序 O(n log n)。重叠是保守提示，不推断叠字意图，不报告不同样式重叠；不同样式也可能存在实际问题，需人工检查。重复比较折叠空白，保留大小写/标点，不检查语义相似。

`formatIssues` 来自 `project-data.inspectAss` / `contracts/subtitle-qc`，与本地同类型、同字幕问题去重。后端每条字幕返回首个致命格式错误；修复后重查可能出现该行后续错误。文档整体错误由原序列化器验证。

测试：`check-subtitles.test.ts`；浏览器：`npm run test:subtitle-qc`。集成所有权、快照、导航和导出规则见 [workspace-ui](../workspace-ui/README.md#字幕-qc)。实际测量见 [验证记录](../../../docs/experiments/subtitle-qc.md)。
