"""Explicit opt-in: manage.py test browser_tests.regression --settings=application.test_settings.

LiveServerTestCase owns the test DB and flushes it between scenarios. The browser
uses the real session/CSRF/API/codec stack. No test routes enter the application.
"""
import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess

from django.test import override_settings

from accounts.models import LoginAttempt, PersonalSettings, User
from accounts.services import save_settings
from organizations.services import add_member, create_organization
from projects.services import create_project, save_document, set_archived
from projects.models import Project
from organizations.models import OrganizationStyleTemplate
from diagnostics.logging import SafeJsonFormatter

from .regression_fixture import RegressionFixture, ROOT, PASSWORD


@override_settings(DEBUG=True)
class WorkspaceRegressionTests(RegressionFixture):
    def run_browser(self, scenario):
        subprocess.run([
            'node', 'node_modules/playwright/cli.js', 'test',
            '--config', 'regression/playwright.config.mjs', '--grep', scenario,
            '--output', f'test-results/{scenario.replace(" ", "-")}',
        ], cwd=ROOT / 'frontend', env={**os.environ,
            'CUERELAY_API_TARGET': self.live_server_url,
            'CUERELAY_REGRESSION_FIXTURES': json.dumps(self.fixtures),
        }, check=True, timeout=240)

    def test_auxiliary_handbook(self):
        User.objects.filter(pk__in=[self.member.pk, self.organizer.pk]).update(handbook_seen=False)
        self.run_browser('auxiliary first handbook acknowledgement persists per real account')
        self.member.refresh_from_db()
        self.organizer.refresh_from_db()
        self.assertTrue(self.member.handbook_seen)
        self.assertTrue(self.organizer.handbook_seen)

    def test_auxiliary_diagnostics(self):
        directory = Path(os.environ.get('CUERELAY_E2E_RUN', self.directory.name))
        directory.mkdir(parents=True, exist_ok=True)
        report_path, log_path = directory / 'diagnostic-download.json', directory / 'isolated-http.jsonl'
        self.fixtures.update(memberId=self.member.pk, diagnosticReport=str(report_path))
        logger = logging.getLogger('cuerelay.diagnostics')
        handler = logging.FileHandler(log_path, encoding='utf8')
        handler.setFormatter(SafeJsonFormatter())
        logger.addHandler(handler)
        try:
            self.run_browser('auxiliary business error diagnostic download correlates safe backend log and account')
        finally:
            logger.removeHandler(handler)
            handler.close()
        report = json.loads(report_path.read_text())
        matches = [json.loads(line) for line in log_path.read_text().splitlines()
                   if json.loads(line).get('request_id') == report['id']]
        self.assertEqual(len(matches), 1)
        self.assertEqual((matches[0]['event'], matches[0]['method'], matches[0]['status']),
                         ('http_result', 'POST', 400))
        self.assertEqual(matches[0]['route'], 'api/auth/password')
        self.assertFalse({'headers', 'body', 'user', 'username', 'password'} & matches[0].keys())
        self.assertNotIn(PASSWORD, log_path.read_text())
        self.assertNotIn('isolated-wrong-password-do-not-record', log_path.read_text())
        self.member.refresh_from_db()
        self.assertTrue(self.member.check_password(PASSWORD))
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 1)

    def test_unknown_split(self):
        self.run_browser('split committed response loss retains local baseline and explicitly reloads')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 3)
        self.assertEqual([cue['text'] for cue in self.project.document['cues']], ['拆分恢复后保存', '本机正文'])
        self.assertEqual(self.project.document['cues'][0]['start_ms'], 200)
        self.assertEqual(self.project.updated_by_id, self.member.pk)

    def test_unknown_styles(self):
        before = self.project.document['cues']
        self.run_browser('styles committed response loss preserves form and independent workspace draft')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 3)
        self.assertEqual(self.project.document['cues'], before)
        self.assertEqual(self.project.document['styles'][0]['fields']['Fontsize'], '63')
        self.assertEqual(self.project.updated_by_id, self.member.pk)

    def test_network_transport(self):
        self.run_browser('network offline timeout and unavailable writes retain drafts until explicit save')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)
        self.assertEqual(self.project.document['cues'][0]['text'], '网络故障本机稿')
        self.assertEqual(self.project.document['cues'][0]['start_ms'], 0)

    def test_network_revocation_recovery(self):
        membership = self.project.organization.memberships.get(user=self.member)
        self.fixtures['membershipPath'] = f'/api/organizations/{self.project.organization_id}/members/{membership.pk}'
        self.run_browser('network revoked project access recovers after real membership restoration')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)
        self.assertEqual(self.project.document['cues'][0]['text'], '撤权恢复保留正文')
        self.assertEqual(self.project.document['cues'][0]['start_ms'], 0)
        self.assertEqual(self.project.organization.memberships.get(user=self.member).role, 'member')

    def test_network_session(self):
        self.run_browser('network real session expiration preserves editor and same account resumes save')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)
        self.assertEqual(self.project.document['cues'][0]['text'], '会话失效保留正文')

    def test_save_refresh_history(self):
        self.run_browser('save refresh and history')

    def test_srt_local(self):
        self.run_browser('srt local import failure')

    def test_account_lifecycle(self):
        self.run_browser('account login password session and logout lifecycle')
        self.member.refresh_from_db()
        self.assertTrue(self.member.check_password('changed-regression-password-928!'))
        self.assertFalse(self.member.check_password(PASSWORD))
        self.organizer.refresh_from_db()
        self.assertTrue(self.organizer.check_password(PASSWORD))

    def test_account_cooldown(self):
        self.run_browser('account cooldown displays real retry contract and preserves credentials')
        key = hashlib.sha256(self.member.username.encode()).hexdigest()
        attempt = LoginAttempt.objects.get(account_key=key)
        self.assertEqual(len(attempt.failure_times), 5)
        self.assertIsNotNone(attempt.locked_until)
        self.assertEqual(attempt.locked_until.timestamp(), attempt.failure_times[-1] + 300)

    def test_account_preferences(self):
        self.run_browser('account preferences persist restore and stay isolated after failed saves')
        personal = PersonalSettings.objects.get(user=self.member)
        self.assertEqual(personal.shortcut_overrides, {})
        self.assertTrue(personal.mouse_sets_cue_boundary)
        self.assertEqual(personal.audio_display_mode, 'spectrum')
        self.assertEqual(personal.language_preference, 'system')
        self.assertFalse(PersonalSettings.objects.filter(user=self.organizer).exists())

    def test_project_create_empty(self):
        self.run_browser('project creates without subtitles after validation failure retains inputs')
        created = Project.objects.get(name='无字幕创建')
        self.assertEqual(Project.objects.count(), 2)
        self.assertEqual((created.revision, created.description), (1, '创建说明保留'))
        self.assertEqual(created.document['cues'], [])
        self.assertEqual(created.media, self.project.media)
        self.assertEqual(created.updated_by_id, self.organizer.pk)

    def test_project_create_ass(self):
        self.run_browser('project creates from ASS with original metadata and refreshes snapshot')
        created = Project.objects.get(name='ASS 创建')
        self.assertEqual(Project.objects.count(), 2)
        self.assertEqual(created.revision, 1)
        self.assertEqual(created.document['source'], Path(self.fixtures['subtitles']).read_text())
        self.assertEqual(len(created.document['cues']), 2)
        self.assertEqual(created.media, self.project.media)

    def test_project_list_filters(self):
        for index in range(27):
            create_project(self.organizer, self.project.organization_id, name=f'组合 {index:02}',
                           description='', source=None, media=self.project.media)
        archived = create_project(self.organizer, self.project.organization_id, name='组合归档',
                                  description='', source=None, media=self.project.media)
        set_archived(self.organizer, archived.organization_id, archived.pk, 1, archived=True)
        other = create_organization('另一组织', self.organizer.pk)
        add_member(self.organizer, other.pk, self.member.username)
        create_project(self.organizer, other.pk, name='另一组织进行中', description='',
                       source=None, media=self.project.media)
        other_archived = create_project(self.organizer, other.pk, name='另一组织归档', description='',
                                       source=None, media=self.project.media)
        set_archived(self.organizer, other.pk, other_archived.pk, 1, archived=True)
        self.fixtures['otherOrganizationId'] = other.pk
        before = list(Project.objects.order_by('pk').values('pk', 'revision', 'status', 'document'))
        self.run_browser('project list combines organization status search and pagination')
        self.assertEqual(list(Project.objects.order_by('pk').values('pk', 'revision', 'status', 'document')), before)

    def test_project_lifecycle(self):
        wrong = Path(self.directory.name) / 'wrong.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                        'color=c=red:s=160x90:r=10:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(wrong)],
                       check=True, timeout=30)
        self.fixtures['wrongVideo'] = str(wrong)
        self.run_browser('project metadata archive restore permissions and video gate persist')
        self.project.refresh_from_db()
        self.assertEqual((self.project.name, self.project.description, self.project.revision, self.project.status),
                         ('修改后项目', '持久化项目说明', 5, 'active'))
        self.assertEqual(self.project.document['cues'][0]['text'], '恢复后成员保存')
        self.assertEqual(self.project.updated_by_id, self.member.pk)
        self.assertIsNone(self.project.archived_at)
        self.assertIsNone(self.project.archived_by_id)

    def test_editing_clipboard_persistence(self):
        source = self.project.document['source'].split('Dialogue:', 1)[0] + '\n'.join([
            'Dialogue: 3,0:00:00.00,0:00:02.00,Default,译者,0010,0020,0030,,甲',
            'Dialogue: 1,0:00:03.00,0:00:04.00,Emphasis,乙者,0001,0002,0003,,乙',
            'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0000,0000,0000,,丙',
        ]) + '\n'
        project = create_project(self.organizer, self.project.organization_id, name='剪贴板项目',
                                 description='', source=source, media=self.project.media)
        self.fixtures.update(projectPath=f'/api/organizations/{project.organization_id}/projects/{project.pk}',
                             workspacePath=f'/organizations/{project.organization_id}/projects/{project.pk}/workspace')
        self.run_browser('editing clipboard cut paste and field overwrite explicitly save and reload')
        project.refresh_from_db()
        self.assertEqual(project.revision, 2)
        self.assertEqual(len(project.document['cues']), 4)
        self.assertCountEqual([cue['text'] for cue in project.document['cues']], ['甲', '乙', '丙', '覆盖正文'])
        self.assertEqual(project.document['source'], source)
        self.assertEqual(project.updated_by_id, self.member.pk)

    def test_editing_structure_persistence(self):
        save_settings(self.member, {'shortcut_overrides': {
            'split-playhead': ['Ctrl+KeyP'], 'set-start-playhead': ['Ctrl+KeyB'], 'set-end-playhead': ['Ctrl+KeyM']}})
        self.run_browser('editing playhead split trim insert delete and multi styles persist')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 3)
        self.assertEqual([(cue['start_ms'], cue['end_ms'], cue['text']) for cue in self.project.document['cues']],
                         [(200, 800, ''), (800, 1000, '插入保留'), (1000, 2000, '')])
        names = {style['id']: style['name'] for style in self.project.document['styles']}
        self.assertEqual([names[cue['style_id']] for cue in self.project.document['cues']],
                         ['Emphasis', 'Default', 'Emphasis'])

    def test_style_template_persistence(self):
        self.run_browser('styles template CRUD member imports batch copy and references persist')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 7)
        self.assertFalse(OrganizationStyleTemplate.objects.exists())
        styles = {style['name']: style for style in self.project.document['styles']}
        self.assertEqual(set(styles), {'Default', 'Emphasis', '引用改名', '副本乙'})
        self.assertEqual(styles['引用改名']['fields']['Fontsize'], '55')
        self.assertEqual(styles['副本乙']['fields']['Fontsize'], '55')
        self.assertEqual(self.project.document['cues'][0]['style_id'], styles['引用改名']['id'])
        self.assertEqual(self.project.updated_by_id, self.member.pk)

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
