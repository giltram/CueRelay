"""Reference persistence/authorization/CAS stay independent of subtitle saves."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from django.core.exceptions import PermissionDenied
from django.db import connections
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from organizations.services import create_organization, add_member, save_permissions, read_permissions, change_member
from projects.models import Project
from projects.services import create_project, save_document, set_archived, ProjectConflict
from projects.reference_services import replace_reference
from srt_format import SrtError

MEDIA = {'sha256': 'b' * 64, 'size': 100, 'duration_ms': 5000}
SRT = '1\n00:00:01,231 --> 00:00:02,234\n<b>参考 &amp; 😀</b>'


class ReferenceTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user('ref-organizer')
        self.member = User.objects.create_user('ref-member')
        self.stranger = User.objects.create_user('ref-stranger')
        self.org = create_organization('Reference', self.actor.pk)
        self.other = create_organization('Other', self.stranger.pk)
        add_member(self.actor, self.org.pk, self.member.username)
        self.project = self.create()
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.actor)
        self.client.get('/api/auth/session')
        self.list_url = f'/api/organizations/{self.org.pk}/projects'
        self.url = self.list_url + f'/{self.project.pk}'

    def create(self, **kw):
        return create_project(self.actor, self.org.pk, name='Ref', description='', media=MEDIA, source=None, **kw)

    def send(self, path, data, method='put', **headers):
        return getattr(self.client, method)(path, data, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, **headers)

    def write(self, source=SRT, version=1):
        return self.send(self.url + '/reference', {'source': source, 'version': version})

    def grant(self, **changes):
        config = read_permissions(self.actor, self.org.pk)
        save_permissions(self.actor, self.org.pk, permissions={**config['permissions'], **changes}, revision=config['revision'])

    def test_create_optional_atomic_and_detail_persistence(self):
        self.assertIsNone(self.project.reference_cues)
        self.assertEqual(self.project.reference_version, 1)
        for source in [None, '', SRT]:
            response = self.send(self.list_url, dict(name='Create', description='', media=MEDIA, source=None, reference_source=source), 'post')
            self.assertEqual(response.status_code, 200)
            created = response.json()['project']
            self.assertEqual(created['reference']['version'], 1)
            expected = None if source is None else [] if not source else [{'start_ms': 1231, 'end_ms': 2234, 'text': '参考 & 😀'}]
            self.assertEqual(created['reference']['cues'], expected)
            self.assertEqual(self.client.get(self.list_url + f'/{created["id"]}').json()['project'], created)
        before = Project.objects.count()
        response = self.send(self.list_url, dict(name='Failed', description='', media=MEDIA, source=None, reference_source='bad'), 'post')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(Project.objects.count(), before)

    def test_add_replace_clear_noop_and_document_save_do_not_interfere(self):
        before = self.client.get(self.url).json()['project']
        self.assertEqual(self.write().status_code, 200)
        current = self.client.get(self.url).json()['project']
        self.assertEqual({k: v for k, v in current.items() if k != 'reference'}, {k: v for k, v in before.items() if k != 'reference'})
        self.assertEqual(self.write(version=2).json()['reference']['version'], 2)  # no-op
        doc = deepcopy(current['document'])
        doc['cues'] = [{'id': 'new-ref-test', 'start_ms': 0, 'end_ms': 1000, 'style_id': doc['styles'][0]['id'], 'text': '正文'}]
        save_document(self.member, self.org.pk, self.project.pk, 1, doc)
        self.assertEqual(self.write(SRT.replace('参考', '更换'), 2).json()['reference']['version'], 3)
        after = self.client.get(self.url).json()['project']
        self.assertEqual(after['revision'], 2)
        self.assertEqual(after['document'], doc)
        self.assertEqual(self.write(None, 3).json()['reference'], {'version': 4, 'cues': None})
        self.assertEqual(self.write(None, 4).json()['reference']['version'], 4)

    def test_format_conflict_and_unknown_fields_preserve_old_reference(self):
        self.write()
        before = self.client.get(self.url).json()
        self.assertEqual(self.write('bad', 2).status_code, 422)
        self.assertEqual(self.write(SRT+'x', 1).json()['error']['code'], 'reference_conflict')
        for version in [True, 0, '2']:
            self.assertEqual(self.write(None, version).status_code, 400)
        self.assertEqual(self.send(self.url + '/reference', {'source': None, 'version': 2, 'document': {}}).status_code, 400)
        self.assertEqual(self.client.get(self.url).json(), before)

    def test_configured_capabilities_not_creator_or_role_heuristics(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.write().status_code, 403)
        self.grant(edit_project=True, create_project=True, edit_subtitles=False)
        self.assertEqual(self.write().status_code, 200)
        self.assertEqual(self.send(self.list_url, dict(name='Member', description='', media=MEDIA, source=None, reference_source=SRT), 'post').status_code, 200)
        # A creator with create_project alone may initialize, but cannot edit later.
        self.grant(edit_project=False)
        self.assertEqual(self.send(self.list_url, dict(name='Creator', description='', media=MEDIA, source=None, reference_source=SRT), 'post').status_code, 200)
        self.assertEqual(self.write(None, 2).status_code, 403)
        membership = self.org.memberships.get(user=self.member)
        change_member(self.actor, self.org.pk, membership.pk)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.write(None, 2).status_code, 403)

    def test_cross_organization_archived_csrf_and_account_boundaries(self):
        self.write()
        self.assertEqual(self.send(f'/api/organizations/{self.other.pk}/projects/{self.project.pk}/reference', {'source': None, 'version': 2}).status_code, 403)
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.send(f'/api/organizations/{self.other.pk}/projects/{self.project.pk}/reference', {'source': None, 'version': 2}).status_code, 404)
        self.client.force_login(self.actor)
        self.assertEqual(self.client.put(self.url+'/reference', {'source': None, 'version': 2}, content_type='application/json').status_code, 403)
        self.assertEqual(self.write_with_wrong_user().status_code, 409)
        set_archived(self.actor, self.org.pk, self.project.pk, 1, archived=True)
        self.assertEqual(self.write(None, 2).json()['error']['code'], 'project_archived')
        self.assertEqual(self.client.get(self.url).json()['project']['reference']['version'], 2)

    def write_with_wrong_user(self):
        return self.send(self.url+'/reference', {'source': None, 'version': 2}, HTTP_X_CUERELAY_USER=str(self.member.pk))


class ReferenceConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.actor = User.objects.create_user('ref-race')
        self.org = create_organization('Race', self.actor.pk)
        self.project = create_project(self.actor, self.org.pk, name='Race', description='', media=MEDIA, source=None)

    def race(self, action):
        barrier = Barrier(2)
        def run(index):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                action(index)
                return 'ok'
            except ProjectConflict:
                return 'conflict'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, index) for index in range(2)]
            return [result.result(timeout=15) for result in futures]

    def test_two_replacements_only_one_cas_succeeds(self):
        self.assertCountEqual(self.race(lambda i: replace_reference(self.actor, self.org.pk, self.project.pk, version=1, source=SRT+str(i))), ['ok', 'conflict'])
        self.project.refresh_from_db()
        self.assertEqual(self.project.reference_version, 2)
        self.assertEqual(self.project.revision, 1)

    def test_reference_and_subtitle_writes_both_survive_without_conflict(self):
        doc = deepcopy(self.project.document)
        doc['cues'] = [{'id': 'new-race', 'start_ms': 0, 'end_ms': 1000, 'style_id': doc['styles'][0]['id'], 'text': '正文'}]
        def action(index):
            if index: replace_reference(self.actor, self.org.pk, self.project.pk, version=1, source=SRT)
            else: save_document(self.actor, self.org.pk, self.project.pk, 1, doc)
        self.assertEqual(self.race(action), ['ok', 'ok'])
        self.project.refresh_from_db()
        self.assertEqual(self.project.document, doc)
        self.assertEqual(self.project.reference_version, 2)
        self.assertEqual(self.project.reference_cues[0]['start_ms'], 1231)
