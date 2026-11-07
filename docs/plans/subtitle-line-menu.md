# 字幕行右键菜单与快捷键

用户要求：删除、前后插入、按当前视频帧前后插入、重复、帧前/后分割、剪切、复制、粘贴、选择字段粘贴覆盖；均可配置快捷键。

## 已核对规则

依据 Aegisub `src/command/subtitle.cpp` / `edit.cpp` / `libresrc/default_config.json`：普通插入继承当前样式、空正文、默认 3000ms，扫描所有行限制到最近可用边界。视频插入以当前帧开始且长 3000ms；before/after 决定事件顺序。重复按连续选中块插入副本；帧前分割在本帧开始，帧后在本帧结束，保留两份正文；帧落在字幕外时新增只覆盖本帧的副本。

项目保持既有非负 10ms、start < end、10 小时、5000 行边界；无法满足则整批拒绝，不制造零长度行。媒体层读取实际 packet presentation timestamp/duration，支持 VFR，不使用平均帧率。

## 用户确认

- 支持 Ctrl/Cmd 多选、Shift 连选及批量操作。
- 保留时间排序，before/after 只决定文档 cues 顺序。
- Paste Over 提供 start/end/style/text 四项，不扩展编辑模型。

## 实施状态

实现与公开契约已移至 [字幕行操作](../subtitle-line-operations.md)，实际检查见 [执行记录](../experiments/subtitle-line-menu.md)。已完成菜单、多选、批量转换、系统剪贴板、四字段覆盖、共享快捷键、文档顺序导出与通用 Modal 所有权下移。没有新增持久状态或项目隐式保存。
