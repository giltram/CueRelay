# CueRelay

面向字幕组的协作字幕工具。still under developing

## env

- Python 3.11.8
- Node 26.4.0
- npm 11.17.0

frontend: `package-lock.json`
backend: `backend/requirements.txt`

## get started

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cd backend
python manage.py runserver 127.0.0.1:8000
```

another terminal：

```sh
cd frontend
npm ci
npm run dev
```

open http://127.0.0.1:5173/。Vite 将 `/api` 代理给 Django；`npm run build` 后也可以用 `npm run preview` 查看构建产物（仍需 Django）。这些是本机开发配置，不用于部署。


## ASS 边界

支持标准 ASS v4+ 样式、中文、文本逗号、`\N`/`\n`/`\h` 和组合 `\b0/1`、`\i0/1`、`\u0/1`、`\s0/1` 标签。保留标准辅助字段、Comment 事件、分号注释与元数据。样式可引用，不提供样式定义编辑。后端纯格式模块唯一负责预检、解析、序列化；预览复用同一个导出接口。

未知字段 / section / 标签、绘图、动画、卡拉 OK、局部字体 / 颜色 / 定位、附件、非空 Effect 等整份拒绝可编辑导入。新输入的不支持文本会阻止预览和导出，不会被清除。仅 UTF-8（可有 BOM）、1MiB、5000 事件、单行 16384 字符、0–9:59:59.99 时间范围；`Text` 须是事件 Format 最后一个字段。原件下载保证字节保留，编辑稿保证已支持语义，不保证 BOM、换行风格或空白逐字节一致。详见 [格式模块契约](backend/ass_format/README.md)。

## test

```sh
source .venv/bin/activate
cd backend
python manage.py check
python manage.py test ass_format http_api
```

```sh
cd frontend
npm run typecheck
npm run test -- --run
npm run build
```

浏览器展开「本机定位测量」可抽测 20 点并复制 JSON。它测量 seeked、呈现帧回调和帧媒体时间差，不读取帧像素，不证明目视稳定或真实参考帧精度。请先停止循环，测量时勿操作视频。检查本机资源请求可用：

```sh
cd frontend
CUERELAY_AUDIT=1 npm run dev
```

终端只记录请求方法、URL 路径、Content-Type、Content-Length，不记录字幕正文。结合浏览器 Network（包含 Worker）、CSP 和源代码检查外部请求。构建后的默认字体/候选远程查询代码可能被打包，但配置 `queryFonts: false` 且仅使用用户字体；不启用远程查询。

合成样本检查、依赖 / 许可证、定位原始数据、Aegisub 抽检结果和真实片源人工步骤见 [实验记录](docs/experiments/media-ass.md)。**合成检查已执行不等于真实片源或熟练成员试用通过**。

架构与未来模块边界见 [docs/architecture.md](docs/architecture.md)。本任务不继续登录、数据库、实时协作或恢复机制。

本地音频分段提取的阶段 A 验证入口与大文件实测限制见 [音频提取记录](docs/experiments/local-audio.md)。打轴页支持 Waveform / Spectrum、滚轮缩放、水平滚动 / 拖动平移、点击定位和入出点拖动；拖动只改时间草稿，按 G 或「应用时间」提交。交互、Worker 缓存及浏览器回归见 [音频时间轴记录](docs/experiments/audio-timeline.md)。
