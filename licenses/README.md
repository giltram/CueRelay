# 开源发布材料

自有代码采用根目录 LICENSE 的 **GPL-3.0-only**；这里的第三方声明、字体和源码归档保留原许可。GPL 允许商业使用，不设置额外的「禁止商用」限制。

## 维护入口

- `npm.json`：实际浏览器运行时依赖的固定版本、许可证、声明和源码包名。构建对照 package-lock 和安装元数据，新增或升级依赖未复核时拒绝发布。
- `upstream.json`：JASSUB WASM 源码和递归子模块、React/Scheduler 原始源码的固定提交、归档 URL、SHA-256。归档首次构建从 HTTPS 下载，缓存到被 Git 忽略的 `.open-source-cache`；后续构建离线复用，任何哈希不符都失败。缓存不属于需要提交的源码。
- `assets.json`：已核验的 WASM、字体和 JASSUB 主源码哈希。更换二进制必须重新核对来源并更新。
- `texts/`：实际版本的完整许可及版权声明。不要只用 SPDX 标识符或感谢名单代替原文。部分 npm 包只在元数据声明许可证而没有单独文本，相关文件明确说明这一事实并附标准全文，不编造上游版权年份。
- `../scripts/prepare_open_source.py`：唯一负责整理和验证静态发布材料；不依赖业务模块或运行中的数据库。
- `../frontend/build/open-source-plugin.ts`：Vite 构建/开发适配；生产输出 `/open-source/`，手册提供一个普通链接。

## JASSUB / WASM 对应源码

安装版本 2.5.23 对应提交 `482a2fed6c8976550f09383e90d92b6ac3360fc9`。2026-11-07 已核对其 `src/jassub.ts`、`src/default.woff2`、两个 `src/wasm/*.wasm` 与安装包字节一致，哈希见 assets.json。

upstream.json 的五个直接子模块提交取自该提交的 Git tree（不是上游浮动分支），并补齐 FreeType 的递归子模块 `subprojects/dlg`。FreeType 的 GitHub 官方镜像用于下载相同提交，原 `.gitmodules` 的来源是 freedesktop.org。所有归档都随部署输出，用户无需依赖第三方服务器才能下载本次发布的源码。

修改或重新构建 WASM 时，可以：

```sh
git clone https://github.com/ThaUnknown/jassub.git
cd jassub
git checkout 482a2fed6c8976550f09383e90d92b6ac3360fc9
git submodule update --init --recursive
docker build -t cuerelay-jassub-build .
docker run --rm -v "$PWD:/code" cuerelay-jassub-build
```

上游 Dockerfile 固定 Emscripten 6.0.12，运行 `make; env MODERN=1 make`。也可解压随发布的 JASSUB 归档，将五个子模块源码各自放到 `.gitmodules` 指定的 `lib/` 目录，并将 dlg 放到 `lib/freetype/subprojects/dlg` 后使用归档内 Dockerfile/Makefile。完整构建脚本、补丁和子模块原始许可均保留在归档中。本次提供源码并核对现有字节，未声称执行了 WASM 重编译或实现逐字节可复现。

React/ReactDOM 19.3.1 的原始源码提交为 `61aa00df822d0eb76d0362eb8b6fdd3527693efe`；Scheduler 0.28.0 为 `1d34f91dfde6bba84d08b683aaba164c7194dacb`，均由对应 npm 发布元数据的 gitHead 固定。npm 安装包快照和这些原始源码归档一起提供，避免只交付编译后的 CJS 文件。

应用通过独立资源 URL 加载 WASM；替换后需更新安装资源与 assets.json，再按 README 构建整个 GPL 前端。自有 JASSUB 适配/子类源码位于 `frontend/src/ass-preview/jassub-renderer.ts`，没有修改 node_modules 中的 JASSUB 源码。没有增加禁止修改、调试或再分发的条款。

## 应用源码及隐私边界

每次构建生成本次工作区的 `sources/cuerelay-source.tar.gz`，包含源码、锁文件、测试、构建脚本、公开文档、授权及占位 `.env.example`。从源码包执行 README 的安装、构建步骤即可重新准备相同依赖版本及许可材料；源码归档不要求接收者访问原仓库。

应用源码文件范围由脚本的 SOURCE_DIRECTORIES / SOURCE_FILES 明确列出，不扫描任意根目录文件；不会遍历符号链接，不收集 .env、.git、node_modules、.venv、数据库、.local-dev、本地片源或生成的 dist。第三方 npm 另行打包，WASM 来源另行下载并固定哈希。新增需要构建的文件类型/目录时同步更新范围及测试；不要在公开源码目录中存放账号或用户数据。

`release.json` 记录组件版本和材料哈希；它描述的是本次构建，而不是仅有 HEAD 的旧快照。开发服务器的下载材料是启动时快照，改源码后重启以更新；生产每次构建重新生成。不要把源码包单独挪走却继续提供对应压缩 JS/WASM。

## Aegisub 与字体来源

`aegisub.txt` 保留 Aegisub 3.2.2（`f743d1411e09cbb2bd34ddd2d4b6738101fab710`）的 `audio_display.cpp`、`audio_colorscheme.cpp` 文件头。标尺规则和 Icy Blue 参数是明确参照点，采用保守保留 BSD 声明的方式；其余快捷键/吸附/行编辑主要参照行为。较新行编辑依据见 `docs/subtitle-line-operations.md`。项目不使用 Aegisub Logo 或宣称官方背书。

Noto 字体未修改，来源见 `frontend/src/ass-preview/fonts/README.md`。额外输出的 default.woff2 已读取 name 表确认为 Liberation Sans 2.00.5（OFL 1.1），并与上述 JASSUB 固定提交字节核对一致；保留它及其准确声明，不再当作来源未知字体。

## 发布验收

运行 `python3 -m unittest discover -s scripts -p 'test_*.py'` 和 `cd frontend && npm run build`。后者包含 TypeScript 检查、材料校验和 Vite 构建。确认 `/open-source/`、LICENSE、完整第三方声明、应用与依赖源码、WASM 子模块归档及 release.json 实际可下载；缺失应返回 404，不能回退成 SPA HTML。

本任务只准备本地发布结果。向 GitHub 推送、更改仓库可见性和线上部署须沿既有发布流程执行；不得把未完成的线上动作记录为已完成。
