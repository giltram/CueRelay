"""Business capabilities are independent of each other and of identity authority."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier, Event
from queue import Queue
from time import monotonic, sleep
from unittest.mock import patch
from django.core.exceptions import PermissionDenied
from django.db import connection, connections, transaction
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from ass_format import empty_document
from projects import services as projects
from projects import glossary_services
from projects.style_services import change_styles
from . import services
from .models import OrganizationMembership
from .permissions import DEFAULT_MEMBER_PERMISSIONS as DEFAULTS, PermissionConflict
from .style_templates import create_template

MEDIA = {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}


class PermissionFixture:
    def setUp(self):
        self.organizer = User.objects.create_user('permission-organizer')
        self.member = User.objects.create_user('permission-member')
        self.dev = User.objects.create_superuser('permission-dev')
        self.outsider = User.objects.create_user('permission-outsider')
        self.org = services.create_organization('Permissions', self.organizer.pk)
        services.add_member(self.organizer, self.org.pk, self.member.username)
        self.other = services.create_organization('Other', self.outsider.pk)
        services.add_member(self.outsider, self.other.pk, self.member.username)
        self.project = projects.create_project(self.organizer, self.org.pk, name='Active', description='', source=None, media=MEDIA)
        document = deepcopy(self.project.document)
        document['cues'] = [dict(id='new-permission', start_ms=0, end_ms=1000, text='Before', style_id=document['styles'][0]['id'])]
        self.project = projects.save_document(self.organizer, self.org.pk, self.project.pk, 1, document)

    def configure(self, **values):
        return services.save_permissions(self.organizer, self.org.pk,
            permissions={**dict.fromkeys(DEFAULTS, False), **values},
            revision=services.read_permissions(self.organizer, self.org.pk)['revision'])


class PermissionContractTests(PermissionFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.client.force_login(self.member)
        self.base = f'/api/organizations/{self.org.pk}'
        self.project_base = f'{self.base}/projects/{self.project.pk}'
        self.configuration = f'{self.base}/member-permissions'
        self.template = create_template(self.organizer, self.org.pk, name='Template', fields=self.project.document['styles'][0]['fields'],
            reference=empty_document()['script'], source_label='')
        self.copy = projects.create_project(self.organizer, self.org.pk, name='Copy', description='', source=None, media=MEDIA)
        self.copy_context = glossary_services.change_association(self.organizer, self.org.pk, self.copy.pk,
            association_version=1, glossary_id=None, fork=True)
        self.archived = projects.create_project(self.organizer, self.org.pk, name='Archived', description='', source=None, media=MEDIA)
        self.archived = projects.set_archived(self.organizer, self.org.pk, self.archived.pk, 1, archived=True)

    def send(self, path, method, data):
        return getattr(self.client, method.lower())(path, data, content_type='application/json')

    def operations(self):
        cue_document = deepcopy(self.project.document)
        cue_document['cues'][0]['text'] = 'After'
        template_input = {key: self.template[key] for key in ('name', 'fields', 'reference', 'source_label')}
        token = dict(association_version=self.copy_context['association_version'], glossary_id=self.copy_context['table']['id'])
        return {
            'create_project': (f'{self.base}/projects', 'POST', dict(name='New', description='', media=MEDIA, source=self.project.document['source'], script=empty_document()['script'], style_imports=[])),
            'edit_project': (self.project_base, 'PATCH', dict(name='Renamed', description='Changed', revision=self.project.revision)),
            'archive_project': (f'{self.project_base}/archive', 'POST', dict(revision=self.project.revision)),
            'restore_project': (f'{self.base}/projects/{self.archived.pk}/restore', 'POST', dict(revision=self.archived.revision)),
            'edit_subtitles': (f'{self.project_base}/document', 'PUT', dict(revision=self.project.revision, document=cue_document)),
            'manage_project_styles': (f'{self.project_base}/styles', 'POST', dict(revision=self.project.revision, document=self.project.document,
                operation=dict(type='create', name='New style', fields=self.project.document['styles'][0]['fields']))),
            'fork_project_glossary': (f'{self.project_base}/glossary', 'PUT', dict(association_version=1, glossary_id=None, fork=True)),
            'edit_project_glossary': (f'{self.base}/projects/{self.copy.pk}/glossary', 'POST', dict(**token, original='Term', translation='Translation', note='')),
            'use_organization_glossary': (f'{self.base}/projects/{self.copy.pk}/glossary', 'PUT', dict(**token, use_organization_default=True)),
            'edit_organization_glossary': (f'{self.base}/glossary', 'POST', dict(association_version=1, glossary_id=None, original='Org term', translation='Translation', note='')),
            'create_style_template': (f'{self.base}/style-templates', 'POST', {**template_input, 'name': 'New template'}),
            'edit_style_template': (f'{self.base}/style-templates/{self.template["id"]}', 'PUT', {**template_input, 'revision': 1, 'name': 'Changed template'}),
            'delete_style_template': (f'{self.base}/style-templates/{self.template["id"]}', 'DELETE', dict(revision=1)),
            'rename_organization': (self.base, 'PATCH', dict(name='Changed org')),
        }

    def test_all_fourteen_http_capabilities_default_deny_and_isolated_grant(self):
        operations = self.operations()
        self.assertEqual(set(operations), set(DEFAULTS))
        for key, (path, method, data) in operations.items():
            for mode in ('default', 'denied', 'granted'):
                with self.subTest(permission=key, mode=mode), transaction.atomic():
                    if mode != 'default':
                        self.configure(**({key: True} if mode == 'granted' else {}))
                    response = self.send(path, method, data)
                    allowed = DEFAULTS[key] if mode == 'default' else mode == 'granted'
                    self.assertEqual(response.status_code, 200 if allowed else 403, response.content)
                    transaction.set_rollback(True)

    def test_organizer_and_dev_keep_all_business_operations_when_members_are_denied(self):
        self.configure()
        for actor in (self.organizer, self.dev):
            self.client.force_login(actor)
            for key, (path, method, data) in self.operations().items():
                with self.subTest(actor=actor.username, permission=key), transaction.atomic():
                    response = self.send(path, method, data)
                    self.assertEqual(response.status_code, 200, response.content)
                    transaction.set_rollback(True)

    def test_configuration_is_manager_only_and_never_grants_identity_authority(self):
        self.configure(**dict.fromkeys(DEFAULTS, True))
        for path, method, data in [
            (self.configuration, 'GET', {}), (self.configuration, 'PUT', dict(permissions=DEFAULTS, revision=2)),
            (f'{self.base}/members', 'POST', dict(username=self.outsider.username)),
            (f'{self.base}/members/{OrganizationMembership.objects.get(organization=self.org, user=self.organizer).pk}', 'DELETE', {}),
            (f'{self.base}/members/{OrganizationMembership.objects.get(organization=self.org, user=self.member).pk}', 'PATCH', dict(role='organizer')),
        ]:
            self.assertEqual(self.send(path, method, data).status_code, 403)
        data = self.client.get(self.base).json()['organization']
        self.assertFalse(data['can_manage'])
        self.assertEqual(data['effective_permissions'], dict.fromkeys(DEFAULTS, True))
        self.assertNotIn('member_permissions', data)
        for suffix in ('', '/members', '/style-templates', '/glossary', '/projects'):
            self.assertEqual(self.client.get(self.base + suffix).status_code, 200)

    def test_config_cas_strict_values_noop_and_organization_isolation(self):
        self.client.force_login(self.organizer)
        config = self.client.get(self.configuration).json()
        self.assertEqual(config, dict(permissions=DEFAULTS, revision=1))
        self.assertEqual(self.send(self.configuration, 'PUT', config).json(), config)
        bad_values = [{}, {**DEFAULTS, 'unknown': True}, {**DEFAULTS, 'edit_subtitles': 1}, {**DEFAULTS, 'edit_subtitles': None}]
        for value in bad_values:
            self.assertEqual(self.send(self.configuration, 'PUT', dict(permissions=value, revision=1)).status_code, 400)
        for revision in (True, '1', 0):
            self.assertEqual(self.send(self.configuration, 'PUT', dict(permissions=DEFAULTS, revision=revision)).status_code, 400)
        changed = {**DEFAULTS, 'edit_subtitles': False}
        self.assertEqual(self.send(self.configuration, 'PUT', dict(permissions=changed, revision=1)).json()['revision'], 2)
        self.assertEqual(self.send(self.configuration, 'PUT', config).status_code, 409)
        self.org.refresh_from_db(); self.other.refresh_from_db()
        self.assertEqual(services.effective_permissions(self.member, self.org), changed)
        self.assertEqual(services.effective_permissions(self.member, self.other), DEFAULTS)
        self.assertEqual(self.client.get(f'/api/organizations/{self.other.pk}/member-permissions').status_code, 403)
        for actor in (self.organizer, self.dev):
            self.assertEqual(services.effective_permissions(actor, self.org), dict.fromkeys(DEFAULTS, True))
        self.assertFalse(OrganizationMembership.objects.filter(user=self.dev).exists())
        self.member.is_active = False; self.member.save()
        with self.assertRaises(PermissionDenied):
            services.effective_permissions(self.member, self.org)

    def test_style_only_snapshot_cannot_smuggle_cues_and_subtitle_only_cannot_change_definitions(self):
        self.configure(manage_project_styles=True)
        document = deepcopy(self.project.document)
        operation = dict(type='create', name='Second', fields=document['styles'][0]['fields'])
        document['cues'][0]['text'] = 'Smuggled'
        with self.assertRaises(PermissionDenied):
            change_styles(self.member, self.org.pk, self.project.pk, self.project.revision, document, operation)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['cues'][0]['text'], 'Before')
        result = change_styles(self.member, self.org.pk, self.project.pk, self.project.revision, self.project.document, operation)
        assign = dict(type='assign', cue_ids=['new-permission'], style_id=result.document['styles'][-1]['id'])
        with self.assertRaises(PermissionDenied):
            change_styles(self.member, self.org.pk, result.pk, result.revision, result.document, assign)
        self.configure(edit_subtitles=True)
        response = self.send(f'{self.project_base}/styles', 'POST', dict(revision=result.revision, document=result.document, operation=assign))
        self.assertEqual(response.status_code, 200, response.content)
        result.refresh_from_db()
        for key in ('styles', 'script', 'source'):
            tampered = deepcopy(result.document)
            if key == 'styles': tampered['styles'][0]['fields']['Fontname'] = 'Other font'
            elif key == 'script': tampered['script']['play_res_x'] = 100
            else: tampered['source'] += '\n;Changed source\n'
            response = self.send(f'{self.project_base}/document', 'PUT', dict(revision=result.revision, document=tampered))
            self.assertIn(response.status_code, (400, 422), response.content)
        with self.assertRaises(PermissionDenied):
            change_styles(self.member, self.org.pk, result.pk, result.revision, result.document, operation)
        self.assertEqual(self.send(f'{self.project_base}/document', 'PUT', dict(revision=1, document=result.document)).status_code, 409)

    def test_grants_do_not_bypass_archive_or_cross_organization(self):
        self.configure(**dict.fromkeys(DEFAULTS, True))
        self.assertEqual(self.send(f'{self.base}/projects/{self.archived.pk}/document', 'PUT', dict(revision=self.archived.revision, document=self.archived.document)).status_code, 409)
        self.assertEqual(self.send(f'{self.base}/projects/{self.archived.pk}/glossary', 'PUT', dict(association_version=1, glossary_id=None, fork=True)).status_code, 409)
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(self.project_base).status_code, 403)
        self.assertEqual(self.send(f'{self.project_base}/document', 'PUT', dict(revision=self.project.revision, document=self.project.document)).status_code, 403)


class PermissionConcurrencyTests(PermissionFixture, TransactionTestCase):
    def worker(self, operation):
        connections.close_all()
        try:
            return operation()
        finally:
            connections.close_all()

    def await_lock(self, pid):
        deadline = monotonic() + 5
        while monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s', [pid])
                row = cursor.fetchone()
            if row and row[0] == 'Lock':
                return
            sleep(0.01)
        self.fail('The competing transaction did not wait on a PostgreSQL lock')

    def publish_pid(self, queue):
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_backend_pid()')
            queue.put(cursor.fetchone()[0])

    def test_simultaneous_config_saves_have_one_winner(self):
        barrier = Barrier(2)
        def update(value):
            barrier.wait(timeout=10)
            try:
                services.save_permissions(self.organizer, self.org.pk, permissions={**DEFAULTS, 'edit_subtitles': False, 'create_project': value}, revision=1)
                return 'saved'
            except PermissionConflict:
                return 'conflict'
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.worker, lambda value=value: update(value)) for value in (True, False)]
            self.assertCountEqual([f.result(timeout=15) for f in futures], ['saved', 'conflict'])

    def test_revocation_committing_before_queued_write_rechecks_permission(self):
        holding, release, queued = Event(), Event(), Queue()
        document = deepcopy(self.project.document); document['cues'][0]['text'] = 'Forbidden'
        def revoke():
            with transaction.atomic():
                services.save_permissions(self.organizer, self.org.pk, permissions={**DEFAULTS, 'edit_subtitles': False}, revision=1)
                holding.set()
                if not release.wait(10): raise TimeoutError()
        def save():
            self.publish_pid(queued)
            try:
                projects.save_document(self.member, self.org.pk, self.project.pk, self.project.revision, document)
                return 'saved'
            except PermissionDenied: return 'denied'
        with ThreadPoolExecutor(2) as pool:
            revoked = pool.submit(self.worker, revoke)
            self.assertTrue(holding.wait(10))
            saved = pool.submit(self.worker, save)
            self.await_lock(queued.get(timeout=10)); release.set()
            revoked.result(timeout=15); self.assertEqual(saved.result(timeout=15), 'denied')
        self.project.refresh_from_db(); self.assertEqual(self.project.document['cues'][0]['text'], 'Before')

    def test_configuration_rechecks_role_after_waiting_for_organization_lock(self):
        holding, release, queued = Event(), Event(), Queue()
        def remove():
            with transaction.atomic():
                target = OrganizationMembership.objects.get(organization=self.org, user=self.organizer)
                services.add_member(self.dev, self.org.pk, self.outsider.username)
                services.change_member(self.dev, self.org.pk, OrganizationMembership.objects.get(organization=self.org, user=self.outsider).pk, role='organizer')
                services.change_member(self.dev, self.org.pk, target.pk, role='member')
                holding.set()
                if not release.wait(10): raise TimeoutError()
        def configure():
            self.publish_pid(queued)
            try:
                services.save_permissions(self.organizer, self.org.pk, permissions=dict.fromkeys(DEFAULTS, True), revision=1)
                return 'saved'
            except PermissionDenied: return 'denied'
        with ThreadPoolExecutor(2) as pool:
            removed = pool.submit(self.worker, remove)
            self.assertTrue(holding.wait(10))
            configured = pool.submit(self.worker, configure)
            self.await_lock(queued.get(timeout=10)); release.set()
            removed.result(timeout=15); self.assertEqual(configured.result(timeout=15), 'denied')
        self.org.refresh_from_db(); self.assertEqual(self.org.permissions_revision, 1)

    def test_write_holding_organization_lock_commits_before_queued_revocation(self):
        holding, release, queued = Event(), Event(), Queue()
        document = deepcopy(self.project.document); document['cues'][0]['text'] = 'Authorized before revocation'
        original = services.require_permission
        def permission(*args):
            original(*args)
            holding.set()
            if not release.wait(10): raise TimeoutError()
        def revoke():
            self.publish_pid(queued)
            return services.save_permissions(self.organizer, self.org.pk, permissions={**DEFAULTS, 'edit_subtitles': False}, revision=1)
        with patch('projects.services.require_permission', side_effect=permission), ThreadPoolExecutor(2) as pool:
            written = pool.submit(self.worker, lambda: projects.save_document(self.member, self.org.pk, self.project.pk, self.project.revision, document))
            self.assertTrue(holding.wait(10))
            revoked = pool.submit(self.worker, revoke)
            self.await_lock(queued.get(timeout=10)); release.set()
            written.result(timeout=15); revoked.result(timeout=15)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document, document)
        with self.assertRaises(PermissionDenied):
            projects.save_document(self.member, self.org.pk, self.project.pk, self.project.revision, document)
