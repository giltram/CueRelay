"""Explicit opt-in: manage.py test browser_tests.regression --settings=application.test_settings.

LiveServerTestCase owns the test DB and flushes it between scenarios. The browser
uses the real session/CSRF/API/codec stack. No test routes enter the application.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from django.conf import settings
from django.db import connection
from django.test import LiveServerTestCase, override_settings

from accounts.models import PersonalSettings, User
from organizations.services import add_member, create_organization
from projects.services import create_project

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = 'cuerelay-regression-password-927!'


@override_settings(DEBUG=True)
class WorkspaceRegressionTests(LiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        if (settings.SETTINGS_MODULE != 'application.test_settings'
                or not connection.settings_dict['NAME'].startswith('test_cuerelay_')):
            raise RuntimeError('E2E requires application.test_settings and a Django-created test database')
        super().setUpClass()
        cls.directory = TemporaryDirectory(prefix='cuerelay-regression-')
        cls.addClassCleanup(cls.directory.cleanup)
        cls.video = Path(cls.directory.name) / 'synthetic.mp4'
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=8',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(cls.video),
        ], check=True, timeout=30)

    def setUp(self):
        organizer = User.objects.create_user('regression-organizer', password=PASSWORD, handbook_seen=True)
        self.member = User.objects.create_user('regression-member', password=PASSWORD, handbook_seen=True)
        organization = create_organization('回归测试组织', organizer.pk)
        add_member(organizer, organization.pk, self.member.username)
        PersonalSettings.objects.create(user=self.member, shortcut_overrides={'split-text': ['Ctrl+KeyT']})
        source = (ROOT / 'backend/ass_format/fixtures/basic.ass').read_text()
        # One plain cue makes text-split expectations independent of the codec.
        source = source[:source.index('Dialogue:')] + 'Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0000,0000,0000,,甲乙\n'
        project = create_project(organizer, organization.pk, name='回归测试项目', description='', source=source,
            media={'sha256': hashlib.sha256(self.video.read_bytes()).hexdigest(),
                   'size': self.video.stat().st_size, 'duration_ms': 8000})
        self.fixtures = {'username': self.member.username, 'password': PASSWORD, 'video': str(self.video),
                         'organizer': organizer.username, 'subtitles': str(ROOT / 'backend/ass_format/fixtures/basic.ass'),
                         'projectPath': f'/api/organizations/{organization.pk}/projects/{project.pk}',
                         'workspacePath': f'/organizations/{organization.pk}/projects/{project.pk}/workspace'}

    def run_browser(self, scenario):
        subprocess.run([
            'node', 'node_modules/playwright/cli.js', 'test',
            '--config', 'regression/playwright.config.mjs', '--grep', scenario,
            '--output', f'test-results/{scenario.replace(" ", "-")}',
        ], cwd=ROOT / 'frontend', env={**os.environ,
            'CUERELAY_API_TARGET': self.live_server_url,
            'CUERELAY_REGRESSION_FIXTURES': json.dumps(self.fixtures),
        }, check=True, timeout=240)

    def test_save_refresh_history(self):
        self.run_browser('save refresh and history')

    def test_conflict_preserves_local_edits(self):
        self.run_browser('conflict preserves local edits')

    def test_project_styles_refresh_and_retry(self):
        self.run_browser('project styles refresh and retry')

    def test_workspace_saves_after_style_changes(self):
        self.run_browser('workspace saves after style changes')

    def test_workspace_protects_deleted_history_styles(self):
        self.run_browser('workspace protects history styles deleted remotely')

    def test_organization_glossary_fork_stays_isolated(self):
        self.run_browser('organization glossary fork stays isolated')

    def test_english_language_preserves_editor_state(self):
        self.run_browser('english language preserves editor state')

    def test_workspace_draft_local(self):
        self.run_browser('workspace draft local')

    def test_workspace_draft_project(self):
        self.run_browser('workspace draft project')

    def test_workspace_draft_tabs(self):
        self.run_browser('workspace draft duplicate tabs')

    def test_workspace_draft_accounts(self):
        self.run_browser('workspace draft account isolation')

    def test_workspace_draft_storage_failure(self):
        self.run_browser('workspace draft IndexedDB write failure')
