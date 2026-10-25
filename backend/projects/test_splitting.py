"""Snapshot split persistence, permissions and real PostgreSQL CAS races."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from unittest.mock import patch
from django.db import connection, connections
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from ass_format import empty_document, serialize_ass
from organizations.services import create_organization, add_member
from . import services
from .models import Project

MEDIA = {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 20000}


def source(text=''):
    doc = empty_document()
    doc['cues'] = [{'id': 'new-test', 'start_ms': 10000, 'end_ms': 16000, 'text': text, 'style_id': doc['styles'][0]['id']}]
    return serialize_ass(doc)


class SplitContractTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner')
        self.member = User.objects.create_user('member')
        self.stranger = User.objects.create_user('stranger')
        self.org = create_organization('split', self.owner.pk)
        add_member(self.owner, self.org.pk, 'member')
        self.project = services.create_project(self.owner, self.org.pk, name='split', description='', media=MEDIA, source=source('甲乙'))
        self.url = f'/api/organizations/{self.org.pk}/projects/{self.project.pk}/split'
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')
        self.client.force_login(self.member)
        self.body = {'revision': 1, 'document': self.project.document, 'cue_id': self.project.document['cues'][0]['id'], 'mode': 'text', 'position': 1}

    def post(self, body=None, **headers):
        return self.client.post(self.url, self.body if body is None else body, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, **headers)

    def test_member_split_saves_entire_snapshot_once_and_second_member_reads_it(self):
        # Preserve unsaved edits in the supplied revision-bound snapshot as well.
        self.body['document']['cues'][0]['style_id'] = self.project.document['styles'][0]['id']
        result = self.post()
        self.assertEqual(result.status_code, 200)
        value = result.json()
        self.assertEqual(value['project']['revision'], 2)
        self.project.refresh_from_db()
        self.assertEqual(self.project.updated_by, self.member)
        self.assertEqual(self.project.document, value['document'])
        self.assertEqual([c['text'] for c in self.project.document['cues']], ['甲', '乙'])
        self.client.force_login(self.owner)
        remote = self.client.get(self.url.removesuffix('/split')).json()['project']
        self.assertEqual(remote['document'], value['document'])
        self.assertEqual(remote['revision'], 2)
        self.assertEqual(self.post().status_code, 409)  # Retry/stale split cannot duplicate rows.
        self.project.refresh_from_db()
        self.assertEqual(len(self.project.document['cues']), 2)

    def test_invalid_input_or_template_keeps_original_snapshot_and_revision(self):
        before = deepcopy(self.project.document)
        bodies = [{**self.body, 'position': 0}, {**self.body, 'position': 2}, {**self.body, 'mode': 'playhead', 'position': 13000},
                  {**self.body, 'cue_id': 'deleted'}, {**self.body, 'extra': True}]
        forged = deepcopy(self.body)
        forged['document']['source'] = forged['document']['source'].replace('Title: CueRelay', 'Title: forged')
        bodies.append(forged)
        for body in bodies:
            self.assertIn(self.post(body).status_code, [400, 422])
            self.project.refresh_from_db()
            self.assertEqual(self.project.document, before)
            self.assertEqual(self.project.revision, 1)

    def test_auth_csrf_identity_membership_archive_and_revision_guards(self):
        self.assertEqual(self.client.post(self.url, self.body, content_type='application/json').status_code, 403)
        self.assertEqual(self.post(HTTP_X_CUERELAY_USER=str(self.owner.pk)).status_code, 409)
        self.client.force_login(self.stranger)
        self.assertEqual(self.post().status_code, 403)
        self.client.logout()
        self.client.get('/api/auth/session')
        self.assertEqual(self.post().status_code, 401)
        self.client.force_login(self.member)
        services.set_archived(self.owner, self.org.pk, self.project.pk, 1, archived=True)
        self.assertEqual(self.post().json()['error']['code'], 'project_archived')
        self.project.refresh_from_db()
        self.assertEqual(len(self.project.document['cues']), 1)
        self.assertEqual(self.project.revision, 2)

    def test_exception_after_write_rolls_back_both_rows_and_revision(self):
        touch = services.touch
        def fail_after_write(project, actor):
            touch(project, actor)
            raise RuntimeError('injected storage failure')
        before = deepcopy(self.project.document)
        with patch.object(services, 'touch', side_effect=fail_after_write), self.assertRaises(RuntimeError):
            services.split_cue(self.member, self.org.pk, self.project.pk, **self.body)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document, before)
        self.assertEqual(self.project.revision, 1)


class SplitConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.owner = User.objects.create_user('owner')
        self.member = User.objects.create_user('member')
        self.org = create_organization('race', self.owner.pk)
        add_member(self.owner, self.org.pk, 'member')
        self.project = services.create_project(self.owner, self.org.pk, name='race', description='', media=MEDIA, source=source())

    def split(self, actor):
        return services.split_cue(actor, self.org.pk, self.project.pk, 1, self.project.document,
            self.project.document['cues'][0]['id'], 'playhead', 13000)

    def race(self, other):
        barrier = Barrier(2)
        def run(action):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                action()
                return 'ok'
            except services.ProjectConflict:
                return 'conflict'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, action) for action in [lambda: self.split(self.owner), other]]
            self.assertCountEqual([future.result(timeout=15) for future in futures], ['ok', 'conflict'])
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)

    def test_two_people_cannot_split_same_snapshot_twice(self):
        self.race(lambda: self.split(self.member))
        self.assertEqual(len(self.project.document['cues']), 2)
        self.assertEqual(len({c['id'] for c in self.project.document['cues']}), 2)

    def test_split_competes_with_delete_snapshot(self):
        deleted = {**self.project.document, 'cues': []}
        self.race(lambda: services.save_document(self.member, self.org.pk, self.project.pk, 1, deleted))
        self.assertIn(len(self.project.document['cues']), [0, 2])

    def test_split_competes_with_edit_snapshot(self):
        edited = deepcopy(self.project.document)
        edited['cues'][0]['text'] = '编辑结果'
        self.race(lambda: services.save_document(self.member, self.org.pk, self.project.pk, 1, edited))
        if len(self.project.document['cues']) == 1:
            self.assertEqual(self.project.document['cues'][0]['text'], '编辑结果')
        else:
            self.assertEqual([c['text'] for c in self.project.document['cues']], ['', ''])

    def test_split_competes_with_archive(self):
        self.race(lambda: services.set_archived(self.owner, self.org.pk, self.project.pk, 1, archived=True))
        self.assertEqual(len(self.project.document['cues']), 1 if self.project.status == 'archived' else 2)
