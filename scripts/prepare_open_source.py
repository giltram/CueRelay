"""Build the self-contained /open-source release materials using only stdlib."""

import argparse
import gzip
import hashlib
import html
import io
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORIES = (
    "backend", "frontend/src", "frontend/build", "frontend/browser-tests",
    "frontend/experiments", "shared", "scripts", "licenses", "docs", "deploy",
)
SOURCE_FILES = (
    "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md", "AGENTS.md", ".env.example",
    ".gitignore", ".nvmrc", "frontend/package.json", "frontend/package-lock.json",
    "frontend/tsconfig.json", "frontend/vite.config.ts", "frontend/index.html",
)
SOURCE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".md", ".json",
    ".txt", ".conf", ".example", ".otf", ".svg", ".ass", ".sh", ".ps1",
    ".yaml", ".yml", ".toml",
}
EXCLUDED_NAMES = {"node_modules", "dist", "__pycache__", ".git", ".venv", ".local-dev", "local-samples"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_files(root):
    """Explicit public source scope; never traverse symlinks or ambient files."""
    paths = [root / name for name in SOURCE_FILES if (root / name).is_file()]
    for name in SOURCE_DIRECTORIES:
        directory = root / name
        if directory.is_symlink():
            raise ValueError(f"Source directory cannot be a symlink: {name}")
        for current, directories, files in os.walk(directory, followlinks=False):
            directories[:] = sorted(d for d in directories if d not in EXCLUDED_NAMES
                                    and not d.startswith(".") and not (Path(current) / d).is_symlink())
            paths.extend(Path(current) / f for f in sorted(files)
                         if not f.startswith(".") and Path(f).suffix in SOURCE_EXTENSIONS)
    for path in sorted(set(paths)):
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Source file cannot escape repository: {path}")
        yield path


def archive(destination, files):
    """Deterministic regular files only; no user IDs, timestamps or local paths."""
    with destination.open("wb") as output, gzip.GzipFile(fileobj=output, mode="wb", mtime=0, filename="") as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as tar:
            for path, name in sorted(files, key=lambda pair: pair[1]):
                if path.is_symlink() or not path.is_file():
                    raise ValueError(f"Only regular source files can be archived: {path}")
                data = path.read_bytes()
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o755 if os.access(path, os.X_OK) else 0o644
                tar.addfile(info, io.BytesIO(data))


def validate_packages(root, packages):
    lock = json.loads((root / "frontend/package-lock.json").read_text())
    runtime = {name.removeprefix("node_modules/"): item for name, item in lock["packages"].items()
               if name and not item.get("dev") and not name.startswith("node_modules/@types/")}
    if set(runtime) != {item["name"] for item in packages}:
        raise ValueError("Runtime dependencies changed; update licenses/npm.json and their notices first")
    for item in packages:
        installed = json.loads((root / "frontend/node_modules" / item["name"] / "package.json").read_text())
        for metadata in [installed, runtime[item["name"]]]:
            if metadata.get("version") != item["version"] or metadata.get("license") != item["license"]:
                raise ValueError(f"Unreviewed dependency version or license: {item['name']}")


def upstream_archive(item, cache):
    cached = cache / Path(item["file"]).name
    if not cached.exists():
        request = urllib.request.Request(item["url"], headers={"User-Agent": "CueRelay-source-release"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        if digest(data) != item["sha256"]:
            raise ValueError(f"Upstream source checksum mismatch: {item['name']}")
        cache.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
    if digest(cached.read_bytes()) != item["sha256"]:
        raise ValueError(f"Cached source checksum mismatch: {item['name']}")
    return cached


def prepare(root, output, cache):
    output.mkdir(parents=True, exist_ok=True)
    packages = json.loads((root / "licenses/npm.json").read_text())
    upstream = json.loads((root / "licenses/upstream.json").read_text())
    validate_packages(root, packages)
    for asset in json.loads((root / "licenses/assets.json").read_text()):
        if digest((root / asset["path"]).read_bytes()) != asset["sha256"]:
            raise ValueError(f"Reviewed third-party asset changed: {asset['path']}")

    def write(name, data):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    write("LICENSE.txt", (root / "LICENSE").read_bytes())
    notices = [(root / "THIRD_PARTY_NOTICES.md").read_text()]
    notice_paths = {item["notice"] for item in packages + upstream}
    notice_paths.update(str(p.relative_to(root / "licenses")) for p in (root / "licenses/texts").glob("*.txt"))
    for name in sorted(notice_paths):
        data = (root / "licenses" / name).read_bytes()
        write(name, data)
        notices.append(f"\n===== {name} =====\n{data.decode('utf-8')}")
    write("THIRD_PARTY_NOTICES.txt", "\n".join(notices).encode())

    sources = output / "sources"
    sources.mkdir(exist_ok=True)
    archive(sources / "cuerelay-source.tar.gz", ((p, "CueRelay/" + p.relative_to(root).as_posix())
                                               for p in source_files(root)))
    for item in packages:
        package = root / "frontend/node_modules" / item["name"]
        files = ((p, "package/" + p.relative_to(package).as_posix()) for p in package.rglob("*") if p.is_file())
        archive(output / item["source"], files)
    for item in upstream:
        write(item["file"], upstream_archive(item, cache).read_bytes())

    files = {p.relative_to(output).as_posix(): digest(p.read_bytes()) for p in sorted(output.rglob("*")) if p.is_file()}
    release = {"license": "GPL-3.0-only", "source": "sources/cuerelay-source.tar.gz",
               "npm": packages, "upstream_sources": upstream, "sha256": files}
    write("release.json", (json.dumps(release, ensure_ascii=False, indent=2) + "\n").encode())
    links = []
    for item in packages:
        links.append(f'<li>{html.escape(item["name"])} {html.escape(item["version"])} — '
                     f'{html.escape(item["license"])} · <a href="{item["notice"]}">许可</a> · '
                     f'<a href="{item["source"]}">对应源码</a></li>')
    wasm_links = [f'<li>{html.escape(item["name"])} <code>{item["revision"]}</code> · '
                  f'<a href="{item["notice"]}">声明</a> · <a href="{item["file"]}">完整源码</a></li>' for item in upstream]
    page = '''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CueRelay 开源许可与源码</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.7 system-ui;color:#222}a{color:#1758a0}li{margin:10px 0;overflow-wrap:anywhere}code{font-size:12px}h1{font-size:24px}h2{font-size:19px}</style>
<h1>CueRelay 开源许可与源码</h1><p>CueRelay 自有代码采用 GPL-3.0-only。第三方代码与字体保留各自许可。软件不提供担保；允许按许可证使用、修改和再分发，包括商业使用。</p>
<p><a href="LICENSE.txt">GPL 许可全文</a> · <a href="THIRD_PARTY_NOTICES.txt">完整第三方声明</a> · <a href="sources/cuerelay-source.tar.gz">本次构建的应用源码</a> · <a href="release.json">版本及 SHA-256 清单</a></p>
<p>应用源码包包含构建说明和锁文件；下列 npm 源码包是构建所用安装包的快照。WASM 源码归档按固定提交提供，子模块及构建说明见应用源码中的 licenses/README.md。字体和 Aegisub 来源的声明包含在完整第三方声明中。</p>
<h2>浏览器依赖</h2><ul>''' + "".join(links) + '</ul><h2>上游原始源码、构建脚本与 WASM 子模块</h2><ul>' + "".join(wasm_links) + '</ul></html>'
    write("index.html", page.encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=ROOT / ".open-source-cache")
    arguments = parser.parse_args()
    prepare(ROOT, arguments.output, arguments.cache)
