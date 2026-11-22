"""Opt-in disposable PostgreSQL + fresh Vite cache/evidence per scenario; never reads .env.

Use --suite full/targeted/backend/platform/media/production/specialists. --pg-bin must point to
an installed PostgreSQL bin directory; no existing cluster is used or kept.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TARGETED = ['test_auxiliary_handbook', 'test_auxiliary_diagnostics', 'test_unknown_split',
            'test_unknown_styles', 'test_network_transport', 'test_network_session', 'test_network_revocation_recovery']
BACKEND = ['accounts', 'diagnostics', 'http_api.test_identity', 'projects', 'ass_format.test_splitting', 'ass_format.test_styles']


def worker():
    sys.path.insert(0, str(ROOT / 'backend'))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'application.test_settings'
    import django
    django.setup()
    from browser_tests.regression import WorkspaceRegressionTests

    def run_browser(self, scenario):
        folder = Path(os.environ['CUERELAY_E2E_RUN']) / 'scenarios' / scenario.replace(' ', '-')
        folder.mkdir(parents=True, exist_ok=False)
        env = {**os.environ, 'CUERELAY_E2E_EVIDENCE': str(folder),
               'CUERELAY_API_TARGET': self.live_server_url,
               'CUERELAY_REGRESSION_FIXTURES': json.dumps(self.fixtures)}
        command = ['node', 'node_modules/playwright/cli.js', 'test', '--config',
                   str(ROOT / 'scripts/browser-regression/playwright.config.mjs'), '--grep', scenario,
                   '--output', str(folder / 'test-results')]
        if os.environ.get('CUERELAY_WEBKIT_DRIVER'):
            command = ['node', 'platform-tests/frozen-webkit.mjs']
        started = time.monotonic()
        with (folder / 'playwright.log').open('w') as log:
            result = subprocess.run(command, cwd=ROOT / 'frontend', env=env, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=300)
        print((folder / 'playwright.log').read_text(), flush=True)
        with (Path(os.environ['CUERELAY_E2E_RUN']) / 'scenario-results.jsonl').open('a') as log:
            log.write(json.dumps({'entry': self._testMethodName, 'scenario': scenario,
                                  'exit': result.returncode, 'seconds': time.monotonic() - started}) + '\n')
        result.check_returncode()
    WorkspaceRegressionTests.run_browser = run_browser
    suite = os.environ['CUERELAY_E2E_SUITE']
    if suite in {'platform', 'media', 'production', 'specialists'}:
        from browser_tests.platforms import PlatformRegressionTests
        PlatformRegressionTests.run_browser = run_browser
        targets = ['browser_tests.platforms.PlatformRegressionTests.test_' + suite]
    elif suite == 'backend':
        targets = BACKEND
    elif suite == 'targeted':
        targets = ['browser_tests.regression.WorkspaceRegressionTests.' + method for method in TARGETED]
    else:
        targets = ['browser_tests.regression']
    from django.core.management import execute_from_command_line
    execute_from_command_line(['manage.py', 'test', *targets, '--settings=application.test_settings', '--noinput', '-v', '2'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=['full', 'targeted', 'backend', 'platform', 'media', 'production', 'specialists'], required=True)
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    parser.add_argument('--specialist', choices=['video-restore', 'audio-timeline', 'audio-audition'], help='Run one named specialist explicitly; default runs all three')
    parser.add_argument('--production-app', action='store_true', help='Use an already built production bundle for platform/media evaluation')
    parser.add_argument('--webkit-driver', type=Path, help='Isolated playwright package for frozen macOS WebKit compatibility evaluation only')
    parser.add_argument('--pg-bin', type=Path, required=True)
    args = parser.parse_args()
    if args.suite not in {'platform', 'media', 'production', 'specialists'} and args.browser != 'chromium':
        parser.error('Unified suite remains Chromium; use --suite platform for compatibility evaluation')
    if args.specialist and args.suite != 'specialists':
        parser.error('--specialist requires --suite specialists')
    if args.production_app and args.suite not in {'platform', 'media'}:
        parser.error('--production-app applies only to platform/media')
    if args.webkit_driver and (args.suite != 'platform' or args.browser != 'webkit'):
        parser.error('--webkit-driver applies only to --suite platform --browser webkit')
    pg = args.pg_bin.resolve()
    for binary in ['initdb', 'pg_ctl', 'psql']:
        if not (pg / binary).is_file():
            parser.error(f'Missing PostgreSQL binary: {pg / binary}')
    run = Path(tempfile.mkdtemp(prefix=f'cuerelay-aux-media-failures-{args.suite}-{args.browser}-', dir='/private/tmp'))
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] if key in os.environ}
    env.update(CUERELAY_E2E_RUN=str(run), CUERELAY_E2E_SUITE=args.suite, CUERELAY_E2E_BROWSER=args.browser,
               PYTHONUNBUFFERED='1', NO_COLOR='1', DEBUG='vite:deps,pw:webserver')
    if args.specialist:
        env['CUERELAY_SPECIALIST'] = args.specialist
    if args.production_app:
        env['CUERELAY_E2E_PRODUCTION'] = '1'
    if args.webkit_driver:
        env['CUERELAY_WEBKIT_DRIVER'] = str(args.webkit_driver.resolve())
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env.update(CUERELAY_TEST_PGPORT=str(port), PGPASSWORD='cuerelay-test-only', PSQLRC='/dev/null')
    meta = {'suite': args.suite, 'browser': args.browser, 'port': port, 'envFile': False, 'keepdb': False,
            'retries': 0, 'run': str(run), 'production_app': args.production_app, 'webkit_driver': str(args.webkit_driver) if args.webkit_driver else None}
    def snapshot(name):
        paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
        # Only repository source, never ignored private files, logs or .env.
        files = [p for p in paths if (ROOT / p).is_file() and '.env' not in Path(p).name]
        hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files}
        (run / name).write_text(json.dumps(hashes, indent=2))
        return hashes
    def cache_hashes():
        cache = ROOT / 'frontend/node_modules/.vite'
        return {str(path.relative_to(cache)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in cache.rglob('*') if path.is_file()}
    meta['default_cache_before'] = cache_hashes()
    before = snapshot('source-before.json')
    for source in before:
        target = run / 'source-before' / source
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / source, target)
    shutil.copy2(__file__, run / 'orchestrator.py')
    def logged(command, name, **options):
        print('COMMAND', command, 'LOG', run / name, flush=True)
        with (run / name).open('w') as log:
            return subprocess.run([str(part) for part in command], cwd=ROOT, env=env,
                                  stdout=log, stderr=subprocess.STDOUT, **options)
    password = run / 'password'
    password.write_text('cuerelay-test-only\n'); password.chmod(0o600)
    started = False
    print('RUN_DIRECTORY=' + str(run), flush=True)
    try:
        logged([pg / 'initdb', '-D', run / 'data', '-U', 'cuerelay_test', '--auth=scram-sha-256',
                f'--pwfile={password}', '--encoding=UTF8', '--locale=C'], 'initdb.log', check=True, timeout=60)
        password.unlink()
        logged([pg / 'pg_ctl', '-D', run / 'data', '-l', run / 'postgres.log', '-o',
                f'-h 127.0.0.1 -p {port} -k {run}', '-w', 'start'], 'start.log', check=True, timeout=60)
        started = True
        start = time.monotonic()
        result = logged([sys.executable, __file__, '--worker'], 'django.log', timeout=10800)
        meta.update(exit=result.returncode, seconds=time.monotonic() - start)
        logged([pg / 'psql', '-X', '-h', '127.0.0.1', '-p', port, '-U', 'cuerelay_test', '-d', 'postgres',
                '-At', '-c', 'SELECT datname FROM pg_database ORDER BY datname'], 'databases-after.txt', check=True, timeout=30)
    finally:
        password.unlink(missing_ok=True)
        if started or (run / 'data/postmaster.pid').exists():
            meta['stop'] = logged([pg / 'pg_ctl', '-D', run / 'data', '-m', 'fast', '-w', 'stop'], 'stop.log', timeout=60).returncode
            meta['status'] = logged([pg / 'pg_ctl', '-D', run / 'data', 'status'], 'status.log', timeout=30).returncode
            meta['postmaster_pid_exists'] = (run / 'data/postmaster.pid').exists()
        meta['source_unchanged'] = before == snapshot('source-after.json')
        meta['default_cache_after'] = cache_hashes()
        meta['default_cache_unchanged'] = meta['default_cache_before'] == meta['default_cache_after']
        (run / 'metadata.json').write_text(json.dumps(meta, indent=2))
        print(json.dumps({key: value for key, value in meta.items() if key not in {'default_cache_before', 'default_cache_after'}}), flush=True)
    return meta.get('exit', 1)


if __name__ == '__main__':
    if sys.argv[1:] == ['--worker']:
        worker()
    else:
        sys.exit(main())
