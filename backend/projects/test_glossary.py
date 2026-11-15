from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from unittest.mock import patch
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection, connections
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from glossary.models import Glossary, Entry
from glossary.services import GlossaryConflict
from organizations.services import create_organization, add_member
from projects.services import create_project, set_archived, save_document, ProjectConflict
from projects import glossary_services as service

MEDIA = {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}
VALUES = {'original': 'Alice', 'translation': '爱丽丝', 'note': '主角'}


class GlossaryTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user('organizer')
        self.member = User.objects.create_user('member')
        self.stranger = User.objects.create_user('stranger')
        self.org = create_organization('A', self.actor.pk)
        self.other_org = create_organization('B', self.stranger.pk)
        add_member(self.actor, self.org.pk, 'member')
        self.project = self.project_named('Video')
        self.second = self.project_named('Second')
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session'); self.client.force_login(self.member)
        self.base = f'/api/organizations/{self.org.pk}/projects/{self.project.pk}/glossary'
        self.org_base = f'/api/organizations/{self.org.pk}/glossary'

    def project_named(self, name):
        return create_project(self.actor, self.org.pk, name=name, description='', media=MEDIA, source=None)

    def context(self, project=None):
        return service.read_context(self.member, self.org.pk, (project or self.project).pk)

    def token(self, context):
        return dict(association_version=context['association_version'], glossary_id=context['table']['id'] if context['table'] else None)

    def add_org(self, **overrides):
        return service.save_organization_entry(self.member, self.org.pk, association_version=1, glossary_id=None, **{**VALUES, **overrides})

    def fork(self, project=None):
        project = project or self.project
        return service.change_association(self.member, self.org.pk, project.pk, **self.token(self.context(project)), fork=True)

    def add_project(self, **overrides):
        return service.save_entry(self.member, self.org.pk, self.project.pk, **self.token(self.context()), **{**VALUES, **overrides})

    def send(self, data, method='POST', path=None):
        return getattr(self.client, method.lower())(path or self.base, data, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_default_reads_create_no_rows_and_all_projects_share_organization_table(self):
        self.assertTrue(self.context()['uses_organization_default'])
        self.assertIsNone(self.context()['table'])
        self.assertFalse(Glossary.objects.exists())
        result = self.add_org()
        self.assertEqual(Glossary.objects.count(), 1)
        self.assertEqual(result['table']['project_count'], 2)
        self.assertEqual(self.context()['table']['id'], self.context(self.second)['table']['id'])
        self.assertEqual(self.context()['entries'][0]['translation'], '爱丽丝')
        third = self.project_named('New project')
        self.assertEqual(self.context(third)['table']['id'], result['table']['id'])
        self.project.refresh_from_db()
        self.assertIsNone(self.project.glossary_id)
        self.assertEqual(self.project.glossary_version, 1)

    def test_project_default_is_server_read_only_until_explicit_fork(self):
        for create_default in [False, True]:
            if create_default: self.add_org()
            with self.assertRaises(GlossaryConflict) as failure:
                self.add_project()
            self.assertEqual(failure.exception.code, 'organization_glossary_read_only')
        self.assertEqual(Glossary.objects.count(), 1)
        self.assertEqual(Entry.objects.count(), 1)
        self.assertEqual(self.fork()['association_version'], 2)
        self.add_project(original='Bob')
        self.assertEqual(self.context()['total'], 2)

    def test_fork_copies_all_entries_with_new_ids_and_no_bidirectional_sync(self):
        original = self.add_org()
        copy = self.fork()
        self.assertFalse(copy['uses_organization_default'])
        self.assertEqual(copy['table']['name'], 'Video')
        self.assertNotEqual(copy['table']['id'], original['table']['id'])
        entry = self.context()['entries'][0]
        self.assertNotEqual(entry['id'], original['entry']['id'])
        self.assertEqual((entry['original'], entry['translation'], entry['note']), ('Alice', '爱丽丝', '主角'))
        service.save_entry(self.member, self.org.pk, self.project.pk, **self.token(copy), entry_id=entry['id'], revision=1,
                           **{**VALUES, 'translation': '项目译名'})
        self.add_project(original='Project only')
        self.add_org(original='Organization only')
        self.assertEqual(service.read_organization_context(self.member, self.org.pk)['total'], 2)
        self.assertEqual(self.context()['total'], 2)
        self.assertEqual(next(e for e in self.context()['entries'] if e['original'] == 'Alice')['translation'], '项目译名')
        self.assertEqual(next(e for e in self.context(self.second)['entries'] if e['original'] == 'Alice')['translation'], '爱丽丝')
        self.assertNotIn('Organization only', [e['original'] for e in self.context()['entries']])
        self.assertNotIn('Project only', [e['original'] for e in self.context(self.second)['entries']])
        second_copy = self.fork(self.second)
        self.assertNotEqual(second_copy['table']['id'], copy['table']['id'])

    def test_empty_organization_fork_stays_private_and_does_not_create_default(self):
        self.fork(); self.add_project()
        self.assertFalse(Glossary.objects.filter(is_organization_default=True).exists())
        self.assertEqual(self.context(self.second)['total'], 0)
        self.assertEqual(Glossary.objects.count(), 1)

    def test_fork_failure_after_copy_and_association_write_rolls_back(self):
        self.add_org()
        from projects.models import Project
        original = Project.save
        def fail(project, *args, **kwargs):
            original(project, *args, **kwargs)
            if kwargs.get('update_fields') == ['glossary', 'glossary_version']:
                raise RuntimeError('after association')
        with patch.object(Project, 'save', fail), self.assertRaises(RuntimeError): self.fork()
        self.assertEqual(Glossary.objects.count(), 1)
        self.assertEqual(Entry.objects.count(), 1)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.glossary_id)
        self.assertEqual(self.project.glossary_version, 1)

    def test_first_organization_entry_failure_rolls_back_default_and_entry(self):
        from glossary.services import save_entry
        def fail(*args, **kwargs):
            save_entry(*args, **kwargs)
            raise RuntimeError('after entry')
        with patch('glossary.services.save_entry', side_effect=fail), self.assertRaises(RuntimeError): self.add_org()
        self.assertFalse(Glossary.objects.exists())
        self.assertFalse(Entry.objects.exists())

    def test_revert_management_permission_keeps_unused_copy_and_blocks_old_drafts(self):
        self.add_org(); copy = self.fork()
        with self.assertRaises(PermissionDenied):
            service.change_association(self.member, self.org.pk, self.project.pk, **self.token(copy), use_organization_default=True)
        result = service.change_association(self.actor, self.org.pk, self.project.pk, **self.token(copy), use_organization_default=True)
        self.assertTrue(result['uses_organization_default'])
        self.assertEqual(result['association_version'], 3)
        self.assertEqual(Glossary.objects.count(), 2)
        with self.assertRaises(GlossaryConflict):
            service.save_entry(self.member, self.org.pk, self.project.pk, **self.token(copy), **VALUES)
        with self.assertRaises(GlossaryConflict):
            service.change_association(self.member, self.org.pk, self.project.pk, **self.token(copy), fork=True)
        self.assertEqual(self.context()['table']['project_count'], 2)

    def test_archive_counts_and_context_read_only_with_live_default_updates(self):
        first = self.add_org()
        set_archived(self.actor, self.org.pk, self.project.pk, 1, archived=True)
        self.assertEqual(self.context()['table']['project_count'], 2)
        self.add_org(original='New organization term')
        self.assertEqual(self.context()['total'], 2)
        with self.assertRaises(ProjectConflict): self.fork()
        with self.assertRaises(ProjectConflict): self.add_project()
        copy = self.fork(self.second)
        self.assertEqual(copy['table']['project_count'], 1)
        self.assertEqual(self.context()['table']['project_count'], 1)
        with self.assertRaises(ProjectConflict):
            service.change_association(self.actor, self.org.pk, self.project.pk, **self.token(self.context()), use_organization_default=True)
        self.assertEqual(self.context()['table']['id'], first['table']['id'])

    def test_identity_organization_scope_and_entry_scope(self):
        first = self.add_org()
        with self.assertRaises(PermissionDenied): service.read_organization_context(self.stranger, self.org.pk)
        with self.assertRaises(PermissionDenied):
            service.save_organization_entry(self.stranger, self.org.pk, association_version=1, glossary_id=None, **VALUES)
        other = service.save_organization_entry(self.stranger, self.other_org.pk, association_version=1, glossary_id=None, **VALUES)
        with self.assertRaises(GlossaryConflict):
            service.read_organization_entry(self.member, self.org.pk, other['table']['id'], other['entry']['id'])
        self.fork()
        with self.assertRaises(GlossaryConflict):
            service.read_entry(self.member, self.org.pk, self.project.pk, first['table']['id'], first['entry']['id'])
        self.member.is_active = False; self.member.save(update_fields=['is_active'])
        with self.assertRaises(PermissionDenied): self.context()

    def test_field_limits_duplicate_literal_search_and_entry_revision(self):
        for field, value in [('original', ''), ('translation', ' \n\t'), ('original', 'a'*201), ('translation', 'a'*201), ('note', 'a'*2001), ('note', '\0'), ('note', '\ud800')]:
            with self.subTest(field=field), self.assertRaises(ValidationError): self.add_org(**{field: value})
        self.assertFalse(Glossary.objects.exists())
        first = self.add_org(original=' Alice ', note='<b>{\\b1} % _ [x]')
        with self.assertRaises(ValidationError): self.add_org(original=' Alice ')
        self.add_org(translation='另一个译名')
        for search, count in [('alice', 2), ('ALICE', 2), ('爱丽', 1), ('%', 1), ('_', 1), ('[x]', 1), ('<b>', 1), ('.*', 0)]:
            self.assertEqual(service.read_organization_context(self.member, self.org.pk, search=search)['total'], count)
        changed = service.save_organization_entry(self.actor, self.org.pk, **self.token(first), entry_id=first['entry']['id'], revision=1, **VALUES)
        self.assertEqual(changed['entry']['revision'], 2)
        with self.assertRaises(GlossaryConflict):
            service.save_organization_entry(self.member, self.org.pk, **self.token(first), entry_id=first['entry']['id'], revision=1, **VALUES)
        self.assertEqual(changed['entry']['updated_by']['username'], 'organizer')

    def test_pagination_and_large_fork_are_bounded_and_complete(self):
        self.add_org()
        table = Glossary.objects.get()
        Entry.objects.bulk_create([Entry(glossary=table, original=str(i), translation='词', note='', updated_by=self.member) for i in range(510)])
        self.assertEqual(len(self.context()['entries']), 25)
        self.assertTrue(self.context()['has_more'])
        self.fork()
        self.assertEqual(self.context()['total'], 511)
        self.assertEqual(Entry.objects.count(), 1022)

    def test_subtitle_document_revision_and_metadata_are_unchanged(self):
        before = deepcopy(self.project.document), self.project.revision, self.project.updated_at, self.project.updated_by_id
        self.add_org(); self.fork(); self.add_project(original='Bob')
        self.project.refresh_from_db()
        self.assertEqual((self.project.document, self.project.revision, self.project.updated_at, self.project.updated_by_id), before)
        document = deepcopy(self.project.document)
        document['cues'] = [{'id': 'new-one', 'text': '字幕草稿', 'start_ms': 0, 'end_ms': 1000, 'style_id': document['styles'][0]['id']}]
        self.assertEqual(save_document(self.member, self.org.pk, self.project.pk, 1, document).revision, 2)

    def test_http_read_only_fork_org_maintenance_csrf_and_no_delete(self):
        body = dict(association_version=1, glossary_id=None, **VALUES)
        self.assertEqual(self.client.post(self.org_base, body, content_type='application/json').status_code, 403)
        first = self.send(body, path=self.org_base)
        self.assertEqual(first.status_code, 200, first.content)
        org = first.json()
        token = self.token(org)
        self.assertEqual(self.send({**token, **VALUES}).json()['error']['code'], 'organization_glossary_read_only')
        copied = self.send({**token, 'fork': True}, 'PUT')
        self.assertEqual(copied.status_code, 200, copied.content)
        self.assertNotIn('document', copied.json())
        entry = self.context()['entries'][0]
        path = self.base + '/' + copied.json()['table']['id'] + '/entries/' + entry['id']
        self.assertEqual(self.send({**self.token(copied.json()), **VALUES, 'note': 'local', 'revision': 1}, 'PUT', path).status_code, 200)
        self.assertEqual(self.send({}, 'DELETE', path).status_code, 405)
        org_path = self.org_base + '/' + org['table']['id'] + '/entries/' + org['entry']['id']
        self.assertEqual(self.client.get(org_path).status_code, 200)
        self.assertEqual(self.send({**token, **VALUES, 'revision': 99}, 'PUT', org_path).status_code, 409)
        self.assertEqual(self.send({**body, 'document': {}}, path=self.org_base).status_code, 400)
        self.assertEqual(self.client.get(self.org_base + '?page=0').status_code, 400)
        self.assertEqual(self.client.get(self.base, HTTP_X_CUERELAY_USER=str(self.actor.pk)).status_code, 409)


class GlossaryConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.actor = User.objects.create_user('organizer')
        self.member = User.objects.create_user('member')
        self.org = create_organization('Race', self.actor.pk)
        add_member(self.actor, self.org.pk, 'member')
        self.project = create_project(self.actor, self.org.pk, name='Race', description='', media=MEDIA, source=None)

    def race(self, left, right):
        barrier = Barrier(2)
        def run(action):
            connections.close_all()
            try:
                barrier.wait(timeout=10); action(); return 'ok'
            except GlossaryConflict: return 'conflict'
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(run, action) for action in [left, right]]
            return [job.result(timeout=20) for job in jobs]

    def add(self, actor, original):
        return service.save_organization_entry(actor, self.org.pk, association_version=1, glossary_id=None, **{**VALUES, 'original': original})

    def test_concurrent_first_org_adds_create_one_default_without_lost_entries(self):
        self.assertEqual(self.race(lambda: self.add(self.actor, 'A'), lambda: self.add(self.member, 'B')), ['ok', 'ok'])
        self.assertEqual(Glossary.objects.count(), 1)
        self.assertEqual(Entry.objects.count(), 2)
        self.project.refresh_from_db(); self.assertEqual(self.project.revision, 1)

    def test_competing_forks_make_one_copy_with_association_cas(self):
        self.add(self.actor, 'A')
        def fork(actor):
            return service.change_association(actor, self.org.pk, self.project.pk, association_version=1, glossary_id=None, fork=True)
        self.assertCountEqual(self.race(lambda: fork(self.actor), lambda: fork(self.member)), ['ok', 'conflict'])
        self.assertEqual(Glossary.objects.count(), 2)
        self.assertEqual(Entry.objects.count(), 2)

    def test_fork_and_organization_edit_produce_a_consistent_snapshot(self):
        first = self.add(self.actor, 'A')
        def edit():
            return service.save_organization_entry(self.actor, self.org.pk, association_version=1, glossary_id=first['table']['id'],
                entry_id=first['entry']['id'], revision=1, original='A', translation='new', note='new')
        self.assertEqual(self.race(edit, lambda: service.change_association(self.member, self.org.pk, self.project.pk,
            association_version=1, glossary_id=first['table']['id'], fork=True)), ['ok', 'ok'])
        row = service.read_context(self.member, self.org.pk, self.project.pk)['entries'][0]
        self.assertIn((row['translation'], row['note']), [('爱丽丝', '主角'), ('new', 'new')])
        self.assertEqual(Entry.objects.count(), 2)
