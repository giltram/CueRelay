"""Project lifecycle/permission contracts, using real PostgreSQL in Django tests."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, connections, connection, transaction
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from organizations.services import create_organization, add_member
from ass_format import AssError, empty_document
from .models import Project
from .services import create_project, save_document, set_archived, update_project, ProjectConflict

MEDIA = {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}


def with_cue(document, text='测试字幕'):
    document = deepcopy(document)
    document['cues'] = [{'id': 'new-test', 'start_ms': 0, 'end_ms': 1000, 'text': text, 'style': 'Default'}]
    return document


class ProjectContractTests(TestCase):
    def setUp(self):
        self.organizer = User.objects.create_user('organizer')
        self.member = User.objects.create_user('member')
        self.stranger = User.objects.create_user('stranger', is_staff=True)
        self.dev = User.objects.create_superuser('dev')
        self.org = create_organization('A', self.organizer.pk)
        self.other_org = create_organization('B', self.stranger.pk)
        add_member(self.organizer, self.org.pk, 'member')
        self.project = create_project(self.organizer, self.org.pk, name='测试项目', description='说明', media=MEDIA, source=None)
        self.base = f'/api/organizations/{self.org.pk}/projects'
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')
        self.client.force_login(self.organizer)

    def send(self, path='', data=None, method='POST'):
        return getattr(self.client, method.lower())(self.base + path, data or {}, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_atomic_creation_and_validated_media_ass(self):
        self.assertEqual(self.project.revision, 1)
        self.assertEqual(self.project.document['cues'], [])
        self.assertEqual(self.project.created_by, self.organizer)
        for media in [{}, {**MEDIA, 'size': True}, {**MEDIA, 'sha256': 'bad'}, {**MEDIA, 'duration_ms': 36_000_000}, {**MEDIA, 'path': '/private/video'}]:
            with self.subTest(media=media), self.assertRaises(ValidationError):
                create_project(self.organizer, self.org.pk, name='bad', description='', media=media, source=None)
        with self.assertRaises(AssError):
            create_project(self.organizer, self.org.pk, name='bad', description='', media=MEDIA, source='not ass')
        self.assertEqual(Project.objects.count(), 1)
        response = self.send('', {'name': '导入', 'description': '', 'media': MEDIA, 'source': empty_document()['source']})
        self.assertEqual(response.status_code, 200)
        self.assertIn('document', response.json()['project'])

    def test_list_filter_search_pagination_excludes_documents(self):
        for index in range(27):
            create_project(self.organizer, self.org.pk, name=f'可搜索 {index}', description='', media=MEDIA, source=None)
        query = self.client.get(self.base + '?search=可搜索&page=1').json()
        self.assertEqual(query['total'], 27)
        self.assertEqual(len(query['projects']), 25)
        self.assertTrue(query['has_more'])
        self.assertNotIn('document', query['projects'][0])
        self.assertNotIn('media', query['projects'][0])
        second = self.client.get(self.base + '?search=可搜索&page=2').json()
        self.assertEqual(len(second['projects']), 2)
        self.assertFalse(second['has_more'])
        self.assertFalse(set(p['id'] for p in second['projects']) & set(p['id'] for p in query['projects']))
        for invalid in ['page=0', 'page=x', 'status=done', 'organization_id=2']:
            self.assertEqual(self.client.get(self.base + '?' + invalid).status_code, 400)

    def test_actor_payloads_only_contain_username(self):
        detail = self.client.get(self.base + f'/{self.project.pk}').json()['project']
        self.assertEqual(detail['updated_by'], {'username': self.organizer.username})
        self.assertIsNone(detail['archived_by'])
        archived = self.send(f'/{self.project.pk}/archive', {'revision': detail['revision']}).json()['project']
        self.assertEqual(archived['archived_by'], {'username': self.organizer.username})
        summary = self.client.get(self.base + '?status=archived').json()['projects'][0]
        self.assertEqual(summary['updated_by'], {'username': self.organizer.username})
        self.assertEqual(summary['archived_by'], {'username': self.organizer.username})

    def test_member_can_read_and_save_but_cannot_manage(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(self.base).status_code, 200)
        self.assertEqual(self.client.get(self.base + f'/{self.project.pk}').status_code, 200)
        for path, data, method in [('', {'name': 'x', 'description': '', 'media': MEDIA, 'source': None}, 'POST'),
                (f'/{self.project.pk}', {'name': 'x', 'description': '', 'revision': 1}, 'PATCH'),
                (f'/{self.project.pk}/archive', {'revision': 1}, 'POST'),
                (f'/{self.project.pk}/restore', {'revision': 1}, 'POST')]:
            self.assertEqual(self.send(path, data, method).status_code, 403)
        result = self.send(f'/{self.project.pk}/document', {'revision': 1, 'document': with_cue(self.project.document)}, 'PUT')
        self.assertEqual(result.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.updated_by, self.member)
        self.assertEqual(self.project.document['cues'][0]['text'], '测试字幕')

    def test_cross_organization_and_guessed_project_id(self):
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(self.base).status_code, 403)
        self.assertEqual(self.client.get(self.base + f'/{self.project.pk}').status_code, 403)
        self.base = f'/api/organizations/{self.other_org.pk}/projects'
        self.assertEqual(self.client.get(self.base + f'/{self.project.pk}').status_code, 404)
        self.assertEqual(self.send(f'/{self.project.pk}/archive', {'revision': 1}).status_code, 404)
        self.client.force_login(self.dev)
        self.base = f'/api/organizations/{self.org.pk}/projects'
        self.assertEqual(self.send(f'/{self.project.pk}', {'name': 'dev 修改', 'description': '', 'revision': 1}, 'PATCH').status_code, 200)
        self.assertFalse(self.dev.memberships.exists())

    def test_metadata_fields_and_immutable_identity(self):
        for extra in [{'organization_id': self.other_org.pk}, {'media': MEDIA}, {'status': 'archived'}, {'is_superuser': True}, {'document': {}}]:
            result = self.send(f'/{self.project.pk}', {'name': 'x', 'description': '', 'revision': 1, **extra}, 'PATCH')
            self.assertEqual(result.status_code, 400)
        for name in ['', 'x' * 101, '\0', '\ud800']:
            self.assertEqual(self.send(f'/{self.project.pk}', {'name': name, 'description': '', 'revision': 1}, 'PATCH').status_code, 400)
        self.assertEqual(self.send(f'/{self.project.pk}', {}, 'DELETE').status_code, 405)
        self.project.refresh_from_db()
        self.assertEqual(self.project.organization, self.org)
        self.assertEqual(self.project.media, MEDIA)

    def test_revision_conflicts_and_noop(self):
        first = update_project(self.organizer, self.org.pk, self.project.pk, 1, name='新名称', description='')
        self.assertEqual(first.revision, 2)
        noop = update_project(self.organizer, self.org.pk, self.project.pk, 2, name='新名称', description='')
        self.assertEqual(noop.revision, 2)
        self.assertEqual(noop.updated_at, first.updated_at)
        self.assertEqual(self.send(f'/{first.pk}', {'name': '旧修改', 'description': '', 'revision': 1}, 'PATCH').status_code, 409)
        self.assertEqual(self.send(f'/{first.pk}/document', {'document': with_cue(first.document), 'revision': 1}, 'PUT').status_code, 409)
        self.assertEqual(self.send(f'/{first.pk}/archive', {'revision': True}).status_code, 400)

    def test_archive_readonly_restore_and_operator_times(self):
        project = set_archived(self.organizer, self.org.pk, self.project.pk, 1, archived=True)
        self.assertIsNotNone(project.archived_at)
        self.assertEqual(project.archived_by, self.organizer)
        self.assertEqual(self.client.get(self.base).json()['projects'], [])
        past = self.client.get(self.base + '?status=archived').json()['projects']
        self.assertEqual(past[0]['archived_by']['username'], 'organizer')
        detail = self.client.get(self.base + f'/{project.pk}').json()['project']
        self.assertEqual(detail['status'], 'archived')
        self.assertIn('document', detail)
        for method, path, data in [('PATCH', f'/{project.pk}', {'name': 'bad', 'description': '', 'revision': 2}),
                ('PUT', f'/{project.pk}/document', {'document': with_cue(project.document), 'revision': 2})]:
            self.assertEqual(self.send(path, data, method).json()['error']['code'], 'project_archived')
        self.assertEqual(self.send(f'/{project.pk}/restore', {'revision': 1}).status_code, 409)
        restored = self.send(f'/{project.pk}/restore', {'revision': 2}).json()['project']
        self.assertEqual(restored['status'], 'active')
        self.assertIsNone(restored['archived_at'])
        self.assertIsNone(restored['archived_by'])

    def test_document_contract_cannot_replace_template_or_style(self):
        forged = deepcopy(self.project.document)
        forged['source'] = forged['source'].replace('Title: CueRelay', 'Title: Forged')
        self.assertEqual(self.send(f'/{self.project.pk}/document', {'revision': 1, 'document': forged}, 'PUT').status_code, 400)
        bad = with_cue(self.project.document, r'{\pos(1,2)}bad')
        self.assertEqual(self.send(f'/{self.project.pk}/document', {'revision': 1, 'document': bad}, 'PUT').status_code, 422)
        invalid = with_cue(self.project.document)
        invalid['cues'][0]['end_ms'] = 0
        self.assertEqual(self.send(f'/{self.project.pk}/document', {'revision': 1, 'document': invalid}, 'PUT').status_code, 422)
        self.project.refresh_from_db(); self.assertEqual(self.project.revision, 1)

    def test_csrf_authentication_inactive_and_revoked_membership(self):
        response = self.client.post(self.base, {}, content_type='application/json')
        self.assertEqual(response.json()['error']['code'], 'csrf_failed')
        self.client.logout()
        self.assertEqual(self.client.get(self.base).status_code, 401)
        self.client.force_login(self.member)
        self.member.is_active = False; self.member.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(self.base).status_code, 401)
        self.member.is_active = True; self.member.save(update_fields=['is_active'])
        self.client.force_login(self.member)
        self.member.memberships.all().delete()
        self.assertEqual(self.client.get(self.base).status_code, 403)

    def test_database_status_and_archive_constraints(self):
        for patch in [{'status': 'deleted'}, {'status': 'archived'}, {'revision': 0}]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                Project.objects.filter(pk=self.project.pk).update(**patch)


class ProjectConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.actor = User.objects.create_user('organizer')
        self.org = create_organization('race', self.actor.pk)
        self.project = create_project(self.actor, self.org.pk, name='race', description='', media=MEDIA, source=None)

    def race(self, first, second):
        barrier = Barrier(2)
        def run(action):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                action()
                return 'ok'
            except ProjectConflict:
                return 'conflict'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run, action) for action in [first, second]]
            self.assertCountEqual([f.result(timeout=15) for f in futures], ['ok', 'conflict'])
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)

    def test_simultaneous_snapshot_saves(self):
        self.race(lambda: save_document(self.actor, self.org.pk, self.project.pk, 1, with_cue(self.project.document, 'A')),
                  lambda: save_document(self.actor, self.org.pk, self.project.pk, 1, with_cue(self.project.document, 'B')))
        self.assertIn(self.project.document['cues'][0]['text'], ['A', 'B'])

    def test_archive_competes_with_save(self):
        self.race(lambda: set_archived(self.actor, self.org.pk, self.project.pk, 1, archived=True),
                  lambda: save_document(self.actor, self.org.pk, self.project.pk, 1, with_cue(self.project.document)))


    def test_deactivation_competes_with_project_creation(self):
        from application.identity_admin import save_account
        from organizations.services import change_member
        other = User.objects.create_superuser('second-organizer')
        membership = add_member(other, self.org.pk, other.username)
        change_member(other, self.org.pk, membership.pk, role='organizer')
        barrier = Barrier(2)
        def create():
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                create_project(self.actor, self.org.pk, name='new project', description='', media=MEDIA, source=None)
                return 'created'
            except PermissionDenied:
                return 'denied'
            finally:
                connections.close_all()
        def deactivate():
            connections.close_all()
            try:
                actor = User.objects.get(pk=self.actor.pk)
                barrier.wait(timeout=10)
                actor.is_active = False
                save_account(actor)
                return 'deactivated'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(create), executor.submit(deactivate)]
            results = [future.result(timeout=15) for future in futures]
        self.assertIn(results[0], ['created', 'denied'])
        self.assertEqual(results[1], 'deactivated')
        self.actor.refresh_from_db()
        self.assertFalse(self.actor.is_active)
