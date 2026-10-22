# CueRelay

面向字幕组的协作字幕工具。本次仅实现第一个 Coding Task：**本地视频 / 打轴 / ASS 验证台**，没有业务数据库、自动保存或多人协作。字幕仅在页面内存中，请及时导出 ASS；关闭、刷新和开发热更新可能丢失修改。

## 本机启动

已验证环境：Python 3.11.8、Node 26.4.0、npm 11.17.0。直接依赖固定版本，前端传递依赖固定在 `package-lock.json`；后端包括传递依赖的固定版本见 `backend/requirements.txt`。不需要迁移数据库。

在仓库根目录：

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cd backend
python manage.py runserver 127.0.0.1:8000
```

另开一个终端：

```sh
cd frontend
npm ci
npm run dev
```

打开 [本机验证台](http://127.0.0.1:5173/)。两个服务均只监听本机。Vite 将 `/api` 代理给 Django；`npm run build` 后也可以用 `npm run preview` 查看构建产物（仍需 Django）。这些是本机开发配置，不用于部署。

## 操作

1. 选择本地视频。成功加载后本次会话片源固定；新片源先导出字幕，再刷新。不能播放的文件会报错，允许重新选择。视频、音频和帧不上传。
2. 播放、暂停或输入 `h:mm:ss.cc` 跳转。用「设为当前」采集入出点，时间吸附到 10ms 网格；入点必须早于出点，零长度不会自动拉长。
3. 创建新行，填写中文或原始 ASS 文本。按 Enter 换行会转为 ASS 的 `\N`。文本和样式即时写入页面内存；时间修改需点「应用时间」。列表按时间浏览，导出仍保留原事件次序。
4. 用 ±10ms 按钮微调待应用区间，用「循环试听」反复播放，再应用时间。按行「定位」会暂停并跳到入点。浏览器寻址不是可靠逐帧，循环边界可能延迟。
5. 导入 UTF-8 ASS，编辑后导出。导入已有字幕时有替换确认；拒绝的文件不会覆盖当前字幕。成功导入和最近被拒的原件分别保留为本地 File，可下载，字节不经序列化。
6. 预览需自行选本地字体文件（最多 30MiB）并填写字体内部族名；默认空文档字体名是占位用的 `Local Test Font`。选择实际字体作为回退；核对导入样式字体与 Aegisub 使用同一字体。未核实缺字、回退和样式匹配，界面持续提示人工核对。字体只传给本地 Worker，不上传、不自动请求系统或远程字体。

点击打轴按钮后可直接继续使用字母快捷键，无需点击空白处。输入框、视频控件和中文输入法组合输入期间不触发；按钮、链接和展开项保有焦点时，空格 / Enter 保留原生操作：

| 按键 | 操作 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| I / O | 采集入点 / 出点 |
| N | 按当前区间创建新行 |
| J / K | 入点 −10 / +10ms |
| U / P | 出点 −10 / +10ms |
| L | 开始 / 停止区间循环 |
| Enter | 应用时间到选中行（焦点不在其他原生控件时） |

## ASS 边界

支持标准 ASS v4+ 样式、中文、文本逗号、`\N`/`\n`/`\h` 和组合 `\b0/1`、`\i0/1`、`\u0/1`、`\s0/1` 标签。保留标准辅助字段、Comment 事件、分号注释与元数据。样式可引用，不提供样式定义编辑。后端纯格式模块唯一负责预检、解析、序列化；预览复用同一个导出接口。

未知字段 / section / 标签、绘图、动画、卡拉 OK、局部字体 / 颜色 / 定位、附件、非空 Effect 等整份拒绝可编辑导入。新输入的不支持文本会阻止预览和导出，不会被清除。仅 UTF-8（可有 BOM）、1MiB、5000 事件、单行 16384 字符、0–9:59:59.99 时间范围；`Text` 须是事件 Format 最后一个字段。原件下载保证字节保留，编辑稿保证已支持语义，不保证 BOM、换行风格或空白逐字节一致。详见 [格式模块契约](backend/ass_format/README.md)。

## 验证

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
