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
from projects.services import create_project, save_document, set_archived

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
        self.organizer = User.objects.create_user('regression-organizer', password=PASSWORD, handbook_seen=True)
        self.member = User.objects.create_user('regression-member', password=PASSWORD, handbook_seen=True)
        organization = create_organization('回归测试组织', self.organizer.pk)
        add_member(self.organizer, organization.pk, self.member.username)
        PersonalSettings.objects.create(user=self.member, shortcut_overrides={'split-text': ['Ctrl+KeyT']})
        source = (ROOT / 'backend/ass_format/fixtures/basic.ass').read_text()
        # One plain cue makes text-split expectations independent of the codec.
        source = source[:source.index('Dialogue:')] + 'Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0000,0000,0000,,甲乙\n'
        project = create_project(self.organizer, organization.pk, name='回归测试项目', description='', source=source,
            media={'sha256': hashlib.sha256(self.video.read_bytes()).hexdigest(),
                   'size': self.video.stat().st_size, 'duration_ms': 8000})
        self.project = project
        self.fixtures = {'username': self.member.username, 'password': PASSWORD, 'video': str(self.video),
                         'organizer': self.organizer.username, 'subtitles': str(ROOT / 'backend/ass_format/fixtures/basic.ass'),
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

    def test_srt_local(self):
        self.run_browser('srt local import failure')

    def test_srt_project(self):
        self.run_browser('srt project creation')

    def test_srt_english_narrow(self):
        self.run_browser('srt english narrow')

    def test_conflict_preserves_local_edits(self):
        self.run_browser('conflict preserves local edits')

    def test_revocation_preserves_local_edits(self):
        membership = self.project.organization.memberships.get(user=self.member)
        self.fixtures['membershipPath'] = (
            f'/api/organizations/{self.project.organization_id}/members/{membership.pk}')
        before = (self.project.document, self.project.revision, self.project.media,
                  self.project.updated_at, self.project.updated_by_id)
        self.run_browser('workspace revocation preserves local edits and backup')
        self.project.refresh_from_db()
        self.assertEqual((self.project.document, self.project.revision, self.project.media,
                          self.project.updated_at, self.project.updated_by_id), before)
        self.assertFalse(self.project.organization.memberships.filter(user=self.member).exists())

    def test_lost_save_response_preserves_draft(self):
        self.fixtures.update(committedText='响应丢失前已提交', recoveredText='明确重载后继续保存')
        expected = {**self.project.document, 'cues': [
            {**self.project.document['cues'][0], 'text': self.fixtures['recoveredText']}]}
        self.run_browser('workspace lost save response preserves draft and recovers explicitly')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 3)
        self.assertEqual(self.project.document, expected)
        self.assertEqual(self.project.updated_by_id, self.member.pk)

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

    def test_workspace_time_shift_project(self):
        self.run_browser('workspace time shift project')

    def test_workspace_time_shift_local(self):
        self.run_browser('workspace time shift local')

    def test_subtitle_replace_project(self):
        self.run_browser('subtitle replace project')

    def test_subtitle_replace_local(self):
        self.run_browser('subtitle replace local')

    def test_workspace_merge_project(self):
        header = self.project.document['source'].split('Dialogue:', 1)[0]
        source = header + '\n'.join([
            r'Dialogue: 2,0:00:03.00,0:00:04.00,Emphasis,甲,0010,0020,0030,,{\i1}甲乙\N继续',
            'Comment: 0,0:00:02.00,0:00:02.50,Default,备注,0000,0000,0000,,保留注释',
            'Dialogue: 0,0:00:01.00,0:00:02.00,Default,乙,0004,0005,0006,,保留',
            'Dialogue: 1,0:00:00.00,0:00:05.00,Default,丙,0007,0008,0009,,甲乙',
            'Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0000,0000,0000,,尾句',
        ]) + '\n'
        organization_id = self.project.organization_id
        project = create_project(self.organizer, organization_id, name='合并测试项目', description='',
                                 source=source, media=self.project.media)
        first, *remaining = project.document['cues']
        anchored = {**first, 'id': 'new-merge-fixture', 'source_id': first['id'], 'ass_fields': {
            'Layer': '4', 'Name': '合并说话人', 'MarginL': '0011', 'MarginR': '0022', 'MarginV': '0033',
        }}
        save_document(self.organizer, organization_id, project.pk, project.revision,
                      {**project.document, 'cues': [anchored, *remaining]})
        archived = create_project(self.organizer, organization_id, name='归档合并测试项目', description='',
                                  source=source, media=self.project.media)
        set_archived(self.organizer, organization_id, archived.pk, archived.revision, archived=True)
        self.fixtures.update(projectPath=f'/api/organizations/{organization_id}/projects/{project.pk}',
                             workspacePath=f'/organizations/{organization_id}/projects/{project.pk}/workspace',
                             archivedWorkspacePath=f'/organizations/{organization_id}/projects/{archived.pk}/workspace')
        self.run_browser('workspace merge project')

    def test_workspace_merge_local(self):
        self.run_browser('workspace merge local')

    def test_workspace_draft_local(self):
        self.run_browser('workspace draft local import, export, reload and discard')

    def test_workspace_draft_project(self):
        self.run_browser('workspace draft project')

    def test_workspace_draft_tabs(self):
        self.run_browser('workspace draft duplicate tabs')

    def test_workspace_draft_accounts(self):
        self.run_browser('workspace draft account isolation')

    def test_workspace_draft_storage_failure(self):
        self.run_browser('workspace draft IndexedDB write failure')

    def test_workspace_draft_unselected_timing(self):
        self.run_browser('workspace draft keeps unselected project timing')

    def test_workspace_draft_empty_timing(self):
        self.run_browser('workspace draft keeps the timing baseline')

    def test_workspace_draft_leave(self):
        self.run_browser('saved workspace leaves the organization without losing the project on failure')

    def test_workspace_draft_stale_offers(self):
        self.run_browser('workspace draft removes stale offers')

    def test_workspace_draft_dev_leave(self):
        self.member.is_superuser = True
        self.member.save(update_fields=['is_superuser'])
        self.run_browser('workspace draft dev can manage after leaving')

    def test_workspace_draft_leave_delete_failure(self):
        """The historical entry now covers discarding to home, without leaving an organization."""
        self.run_browser('workspace discard reaches home and reports local deletion failure')

    def test_workspace_draft_concurrent_exports(self):
        self.run_browser('workspace draft concurrent exports keep both offers')

    def test_organizations_load_when_preferences_fail(self):
        self.run_browser('project list loads when personal settings fail')

    def test_workspace_leave_uses_refreshed_organizations(self):
        self.seed_organization_change()
        self.run_browser('workspace leave uses the refreshed organization list')

    def test_workspace_leave_retries_organizations(self):
        self.seed_organization_change()
        self.run_browser('workspace leave retries organization refresh from the unscoped list')

    def test_organization_refresh_ignores_old_permissions(self):
        self.seed_organization_change()
        self.run_browser('organization refresh ignores a late list from before revocation')

    def seed_organization_change(self):
        revoked = create_organization('同步前可访问的组织', self.organizer.pk)
        membership = add_member(self.organizer, revoked.pk, self.member.username)
        available = create_organization('同步后可访问的组织', self.organizer.pk)
        add_member(self.organizer, available.pk, self.member.username)
        self.fixtures.update(revokedMembershipPath=f'/api/organizations/{revoked.pk}/members/{membership.pk}',
                             availableListPath=f'/organizations/{available.pk}/projects')

    def test_workspace_draft_local_timing_diagnostics(self):
        self.run_browser('workspace draft local timing diagnostics clear at baseline')
