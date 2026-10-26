"""Opt-in real proxy regression: NGINX_BINARY=/path/to/nginx manage.py test ..."""
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
from tempfile import TemporaryDirectory
import time
from unittest import skipUnless
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPCookieProcessor, Request
from django.test import LiveServerTestCase, override_settings
from accounts.models import User
from ass_format import empty_document
from organizations.services import create_organization
from projects.models import Project

NGINX = os.environ.get('NGINX_BINARY') or shutil.which('nginx')
ROOT = Path(__file__).resolve().parents[2]


@skipUnless(NGINX, 'Set NGINX_BINARY to run the real reverse-proxy regression')
@override_settings(SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False,
                   ALLOWED_HOSTS=['localhost', '127.0.0.1', 'testserver'])
class ProxyRequestLimitTests(LiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = TemporaryDirectory(prefix='cuerelay-proxy-')
        cls.addClassCleanup(cls.directory.cleanup)
        folder = Path(cls.directory.name)
        (folder / 'logs').mkdir()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        cls.proxy_url = f'http://127.0.0.1:{port}'
        server = (ROOT / 'deploy/nginx.conf.example').read_text()
        server = server.replace('listen 8080;', f'listen 127.0.0.1:{port};')
        server = server.replace('http://127.0.0.1:8000', cls.live_server_url)
        server = server.replace('/etc/nginx/snippets/cuerelay-frontend-headers.conf', str(ROOT / 'deploy/frontend-headers.conf'))
        config = folder / 'nginx.conf'
        config.write_text(f'pid {folder}/nginx.pid;\nerror_log {folder}/error.log;\nevents {{}}\n'
                          f'http {{ access_log off; client_body_temp_path {folder}/client; '
                          f'proxy_temp_path {folder}/proxy; {server} }}\n')
        subprocess.run([NGINX, '-p', f'{folder}/', '-c', str(config), '-t'], check=True, capture_output=True)
        process = subprocess.Popen([NGINX, '-p', f'{folder}/', '-c', str(config), '-g', 'daemon off;'])
        def stop():
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        cls.addClassCleanup(stop)
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError((folder / 'error.log').read_text())
            try:
                with build_opener().open(cls.proxy_url + '/api/ass/empty', timeout=1) as response:
                    if response.status == 200:
                        return
            except URLError:
                time.sleep(0.05)
        raise RuntimeError('Temporary Nginx did not become ready')

    def request(self, path, body=None, method=None):
        headers = {}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
            headers['Content-Type'] = 'application/json'
            headers['X-CSRFToken'] = next(cookie.value for cookie in self.cookies if cookie.name == 'csrftoken')
        request = Request(self.proxy_url + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_large_document_import_export_preview_and_authorized_save(self):
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        password = 'isolated-proxy-test-password-927!'
        actor = User.objects.create_user('proxy-organizer', password=password)
        organization = create_organization('Proxy test', actor.pk)
        self.assertEqual(self.request('/api/auth/session')[0], 200)
        self.assertEqual(self.request('/api/auth/login', {'username': actor.username, 'password': password})[0], 200)
        source = empty_document()['source'] + (
            'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0000,0000,0000,,' + 'a' * 1000 + '\n') * 600
        self.assertLess(len(source.encode()), 1024 * 1024)
        status, body = self.request('/api/ass/import', {'source': source})
        self.assertEqual(status, 200, body[:200])
        document = json.loads(body)['document']
        self.assertGreater(len(json.dumps({'document': document}).encode()), 1024 * 1024)
        # Real-time preview and download both use this one serializer endpoint.
        status, body = self.request('/api/ass/export', {'document': document})
        self.assertEqual(status, 200, body[:200])
        self.assertEqual(body.decode(), source)
        projects_url = f'/api/organizations/{organization.pk}/projects'
        status, body = self.request(projects_url, {'name': 'Large ASS', 'description': '', 'source': source,
            'media': {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}})
        self.assertEqual(status, 200, body[:200])
        project = json.loads(body)['project']
        document = project['document']
        document['cues'][0]['text'] = 'saved through nginx'
        document_url = projects_url + f'/{project["id"]}/document'
        status, body = self.request(document_url, {'revision': 1, 'document': document}, method='PUT')
        self.assertEqual(status, 200, body[:200])
        self.assertEqual(json.loads(body)['project']['revision'], 2)
        saved = Project.objects.get(pk=project['id'])
        self.assertEqual(saved.document, document)
        # API and conversion clients receive their respective structured errors.
        too_large = {'source': 'x' * (3 * 1024 * 1024)}
        for path in ['/api', '/api/ass/import', document_url]:
            status, body = self.request(path, too_large, method='PUT' if path == document_url else 'POST')
            self.assertEqual(status, 413)
            error = json.loads(body)
            self.assertEqual(error['issues'][0]['code'], 'too_large')
            self.assertEqual(error['error']['code'], 'too_large')
        saved.refresh_from_db()
        self.assertEqual(saved.revision, 2)
        self.assertEqual(saved.document, document)
        # Raising the JSON budget must not raise the ASS format limit.
        status, _ = self.request('/api/ass/import', {'source': 'x' * (1024 * 1024 + 1)})
        self.assertEqual(status, 422)
