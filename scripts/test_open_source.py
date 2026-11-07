import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("prepare_open_source.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSourceTests(unittest.TestCase):
    def test_source_scope_excludes_private_files_and_symlink_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ["frontend/src/main.ts", "frontend/package-lock.json", "scripts/build.py",
                         "backend/.env", ".env", ".env.example", ".git/config",
                         "frontend/dist/output.js", "frontend/node_modules/pkg/index.js",
                         ".local-dev/password.txt", "local-samples/private.ass", "backend/db.sqlite3"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            (root / "frontend/src/private").symlink_to(root / ".local-dev", target_is_directory=True)
            names = {str(p.relative_to(root)) for p in release.source_files(root)}
            self.assertEqual(names, {"frontend/src/main.ts", "frontend/package-lock.json", "scripts/build.py", ".env.example"})

    def test_file_symlink_cannot_export_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "backend").mkdir()
            (root / ".env").write_text("private")
            (root / "backend/export.py").symlink_to(root / ".env")
            with self.assertRaisesRegex(ValueError, "escape"):
                list(release.source_files(root))

    def test_archive_is_reproducible_and_contains_working_tree_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "main.ts"
            source.write_text("uncommitted source")
            first, second = root / "first.tar.gz", root / "second.tar.gz"
            for output in [first, second]:
                release.archive(output, [(source, "CueRelay/main.ts")])
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with tarfile.open(first) as archive:
                self.assertEqual(archive.extractfile("CueRelay/main.ts").read(), b"uncommitted source")
                member = archive.getmember("CueRelay/main.ts")
                self.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))

    def test_cached_source_must_match_reviewed_checksum(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / "source.tar.gz").write_bytes(b"substituted content")
            with self.assertRaisesRegex(ValueError, "checksum"):
                release.upstream_archive({"file": "sources/source.tar.gz", "sha256": "wrong", "name": "fixture"}, cache)

    def test_new_runtime_dependency_blocks_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "frontend").mkdir()
            (root / "frontend/package-lock.json").write_text(json.dumps({"packages": {
                "node_modules/unreviewed": {"version": "1.0.0", "license": "MIT"},
            }}))
            with self.assertRaisesRegex(ValueError, "dependencies changed"):
                release.validate_packages(root, [])


if __name__ == "__main__":
    unittest.main()
