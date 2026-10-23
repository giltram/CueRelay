# 字幕区间配色与方向标识

2026-10-23。目标：参照用户 Aegisub 截图，让当前 / 非当前字幕内的频谱本身使用可区分的色表，并给所有可见真实边界添加上下朝内的三角端帽。

依据：Aegisub 3.2.2 `AudioColorScheme` 按 Normal / Inactive / Selection / Primary 分别生成 HSL 色表，SpectrumRenderer 按 style 选表；默认 Icy Blue 的 Inactive / Primary 提高亮度基值并使用不同饱和度。`AudioDisplay::PaintFoot` 在竖线两端绘制朝左右的三角形。来源：[默认配置](https://github.com/Aegisub/Aegisub/blob/v3.2.2/src/libresrc/default_config.json)、[配色](https://github.com/Aegisub/Aegisub/blob/v3.2.2/src/audio_colorscheme.cpp)、[标记绘制](https://github.com/Aegisub/Aegisub/blob/v3.2.2/src/audio_display.cpp)。这是能量到颜色的映射，不是音频处理或按图片叠加滤镜。

实施约束 / 顺序：

1. 保留 normal 的既有黑蓝青白色表、STFT / dBFS 和频率轴；只增添 inactive / active 色表，复用原能量与目标高度像素转换。
2. 由共享区间投影提供裁剪，先 normal、再非当前区间联合、最后当前时间草稿；重叠不得累计调色，当前行优先。编辑只更新区间绘制，不再解码音轨。
3. 同一 spectrum tile 的每种色表 / 目标高度各缓存一个图像，WeakMap 随 tile 生命周期释放。
4. 当前与非当前边界共用端帽组件与 CSS 方向规则，真实入点向右、出点向左；视窗裁剪边缘不伪造端帽，端帽不增加拖动命中区。
5. 验证色表、区间裁剪与优先级、真实 Canvas 像素、端帽上下位置、平移 / 缩放 / DPR 和原拖动 / 快捷键回归，再核对 5177 预览。

已执行验证：

- `npm run test -- --run`：14 文件、149 项通过。新增色表亮度 / 端点颜色、同一能量在三种色表中的像素位置与不变性、当前草稿和只读区间共用裁剪规则测试。
- `npm run build`（含 TypeScript 检查）、`git diff --check`、browser script 语法检查通过。
- `npm run test:audio-timeline`：Chrome 147 完整通过；Canvas 像素实测区间外静音 [8,8,12]、非当前区间静音 [32,24,40]、当前区间静音 [64,32,96]，同一时间 / 频率的语音像素随色表改变，修改草稿不增加 decodedSegments，当前区间在重叠处优先。所有可见真实边界均有上下两个端帽、位于 22px 标尺下方与本体底部，pointer-events:none；滚动 / 缩放时位置正确。
- 原默认 2 秒行、导入保护、G / Enter / 删除、焦点 / IME、边界拖动、播放头、标尺 / DPR、窄屏、导出与请求压力检查通过，无页面异常和媒体上传。压力检查最大心跳间隔约 54ms，无长任务。
- 已查看合成频谱区间截图：已有区间为较暗的紫色背景与较亮的青绿信号；当前行更亮，所有边界的橙 / 紫端帽清晰。仍保留原 normal 色表和能量尺度，非完整逐像素复刻；未重新验收真实片源语音。
