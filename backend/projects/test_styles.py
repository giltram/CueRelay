from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from unittest.mock import patch
from django.core.exceptions import ValidationError
from django.db import connections, connection
from django.test import Client, TestCase, TransactionTestCase
from accounts.models import User
from organizations.services import create_organization, add_member
from organizations.style_templates import create_template, update_template, delete_template, TemplateConflict
from organizations.models import OrganizationStyleTemplate
from ass_format import empty_document, serialize_ass
from .models import Project
from .services import create_project, save_document, ProjectConflict, set_archived
from .style_services import change_styles

MEDIA = {'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}


class StyleIntegrationTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user('organizer')
        self.member = User.objects.create_user('member')
        self.stranger = User.objects.create_user('stranger')
        self.org = create_organization('A', self.actor.pk)
        self.other = create_organization('B', self.stranger.pk)
        add_member(self.actor, self.org.pk, 'member')
        self.project = create_project(self.actor, self.org.pk, name='Project', description='', media=MEDIA, source=None)
        document = empty_document()
        self.template_data = {'name': 'Actor', 'fields': document['styles'][0]['fields'], 'reference': document['script'], 'source_label': 'ASS source'}
        self.template = create_template(self.actor, self.org.pk, **self.template_data)
        self.base = f'/api/organizations/{self.org.pk}'
        self.style_path = self.base + f'/projects/{self.project.pk}/styles'
        self.template_path = self.base + '/style-templates'
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session'); self.client.force_login(self.actor)

    def send(self, path, data, method='POST'):
        return getattr(self.client, method.lower())(path, data, content_type='application/json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def operation(self, operation, **overrides):
        return self.send(self.style_path, {'revision': self.project.revision, 'document': self.project.document, 'operation': operation, **overrides})

    def import_op(self, name='Imported'):
        return {'type': 'import', 'template_id': self.template['id'], 'revision': self.template['revision'], 'name': name, 'mode': 'copy'}

    def test_template_crud_revision_and_copy_on_import(self):
        response = self.operation(self.import_op())
        self.assertEqual(response.status_code, 200, response.content)
        self.project.refresh_from_db()
        imported = self.project.document['styles'][-1]
        self.assertEqual(imported['origin'], {'template_id': self.template['id'], 'revision': 1})
        updated = self.send(self.template_path + '/' + self.template['id'],
            {**self.template_data, 'fields': {**self.template_data['fields'], 'Fontsize': '60'}, 'revision': 1}, 'PUT')
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()['template']['revision'], 2)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['styles'][-1], imported)
        conflict = self.send(self.template_path + '/' + self.template['id'], {**self.template_data, 'revision': 1}, 'PUT')
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.operation(self.import_op('Stale')).status_code, 409)
        self.assertEqual(self.send(self.template_path + '/' + self.template['id'], {'revision': 2}, 'DELETE').status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['styles'][-1], imported)

    def test_create_project_imports_and_failure_rolls_back_creation(self):
        data = {'name': 'With templates', 'description': '', 'media': MEDIA, 'source': None,
                'style_imports': [self.import_op()], 'script': {'play_res_x': 1280, 'play_res_y': 720, 'scaled_border_and_shadow': True}}
        response = self.send(self.base + '/projects', data)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()['project']['document']['styles']), 2)
        count = Project.objects.count()
        bad = {**data, 'style_imports': [self.import_op(), self.import_op()]}
        self.assertEqual(self.send(self.base + '/projects', bad).status_code, 422)
        self.assertEqual(Project.objects.count(), count)
        stale = {**data, 'style_imports': [{**self.import_op(), 'revision': 999}]}
        self.assertEqual(self.send(self.base + '/projects', stale).status_code, 409)
        self.assertEqual(Project.objects.count(), count)

    def test_copy_batch_assign_rename_preserve_colors_and_cue_identity(self):
        original = self.project.document['styles'][0]
        document = deepcopy(self.project.document)
        document['cues'] = [{'id': 'new-cue', 'text': '未保存文字', 'start_ms': 0, 'end_ms': 1000, 'style_id': original['id']}]
        response = self.operation({'type': 'copy', 'id': original['id'], 'name': 'B', 'fields': {'PrimaryColour': '&H000000FF'}}, document=document)
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['cues'][0]['text'], '未保存文字')
        styles = self.project.document['styles']
        response = self.operation({'type': 'batch', 'ids': [s['id'] for s in styles], 'fields': {'Fontsize': '55'}})
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual([s['fields']['PrimaryColour'] for s in self.project.document['styles']], ['&H00FFFFFF', '&H000000FF'])
        assigned = self.operation({'type': 'assign', 'cue_ids': ['new-cue'], 'style_id': styles[1]['id']})
        self.assertEqual(assigned.status_code, 200)
        self.project.refresh_from_db()
        renamed = self.operation({'type': 'update', 'id': styles[1]['id'], 'name': 'Renamed', 'fields': {}})
        self.assertEqual(renamed.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['cues'][0]['style_id'], styles[1]['id'])
        self.assertIn('0:00:01.00,Renamed,', serialize_ass(self.project.document))
        revision = self.project.revision
        self.assertEqual(self.operation({'type': 'delete', 'ids': [styles[1]['id']]}).status_code, 422)
        self.project.refresh_from_db(); self.assertEqual(self.project.revision, revision)
        self.assertEqual(self.operation({'type': 'delete', 'ids': [original['id']]}).status_code, 200)

    def test_invalid_scope_provenance_bypass_and_batch_failure(self):
        other_project = create_project(self.actor, self.org.pk, name='Other', description='', media=MEDIA, source=None)
        foreign_id = other_project.document['styles'][0]['id']
        own = self.project.document['styles'][0]['id']
        for operation in [{'type': 'batch', 'ids': [own, foreign_id], 'fields': {'Fontsize': '55'}},
                          {'type': 'update', 'id': foreign_id, 'name': 'bad', 'fields': {}},
                          {'type': 'create', 'id': foreign_id, 'name': 'bad', 'fields': self.template_data['fields']},
                          {'type': 'batch', 'ids': [own], 'fields': {'Fontsize': 'NaN'}}]:
            self.assertEqual(self.operation(operation).status_code, 422)
        forged = deepcopy(self.project.document)
        forged['styles'][0]['origin'] = {'template_id': self.template['id'], 'revision': 1}
        self.assertEqual(self.operation({'type': 'delete', 'ids': [own]}, document=forged).status_code, 400)
        forged = deepcopy(self.project.document)
        forged['cues'] = [{'id': 'new-foreign', 'text': 'bad', 'start_ms': 0, 'end_ms': 1000, 'style_id': foreign_id}]
        self.assertEqual(self.send(self.base + f'/projects/{self.project.pk}/document', {'revision': 1, 'document': forged}, 'PUT').status_code, 422)
        self.project.refresh_from_db(); self.assertEqual(self.project.revision, 1)
        self.client.force_login(self.stranger)
        foreign_template = create_template(self.stranger, self.other.pk, **self.template_data)
        self.client.force_login(self.actor)
        self.assertEqual(self.operation({**self.import_op(), 'template_id': foreign_template['id']}).status_code, 404)

    def test_permissions_archive_csrf_and_stale_versions(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(self.template_path).status_code, 200)
        self.assertEqual(self.send(self.template_path, self.template_data).status_code, 403)
        self.assertEqual(self.send(self.template_path + '/' + self.template['id'], {**self.template_data, 'revision': 1}, 'PUT').status_code, 403)
        self.assertEqual(self.send(self.template_path + '/' + self.template['id'], {'revision': 1}, 'DELETE').status_code, 403)
        own = self.project.document['styles'][0]['id']
        operation = {'type': 'update', 'id': own, 'name': 'Member edit', 'fields': {}}
        self.assertEqual(self.operation(operation).status_code, 200)
        self.assertEqual(self.operation(operation).status_code, 409)
        self.project.refresh_from_db()
        self.assertEqual(self.project.updated_by, self.member)
        self.assertEqual(self.client.post(self.style_path, {}, content_type='application/json').status_code, 403)
        self.client.force_login(self.stranger)
        self.assertEqual(self.operation(operation).status_code, 403)
        self.assertEqual(self.client.get(self.template_path).status_code, 403)
        self.client.force_login(self.actor)
        set_archived(self.actor, self.org.pk, self.project.pk, self.project.revision, archived=True)
        self.project.refresh_from_db()
        self.assertEqual(self.operation(operation).json()['error']['code'], 'project_archived')

    def test_noop_and_transaction_failure_roll_back_snapshot_and_actor(self):
        own = self.project.document['styles'][0]['id']
        op = {'type': 'update', 'id': own, 'name': 'Default', 'fields': {}}
        self.assertEqual(self.operation(op).json()['project']['revision'], 1)
        old = deepcopy(self.project.document)
        from projects.services import touch
        def fail_after_write(project, actor):
            touch(project, actor)
            raise RuntimeError('injected failure')
        with patch('projects.style_services.touch', side_effect=fail_after_write), self.assertRaises(RuntimeError):
            change_styles(self.member, self.org.pk, self.project.pk, 1, self.project.document, {**op, 'name': 'Changed'})
        self.project.refresh_from_db()
        self.assertEqual(self.project.document, old)
        self.assertEqual(self.project.revision, 1)
        self.assertEqual(self.project.updated_by, self.actor)


class StyleConcurrencyTests(TransactionTestCase):
    def test_template_and_project_conflicts_use_real_connections(self):
        self.assertEqual(connection.vendor, 'postgresql')
        actor = User.objects.create_user('organizer')
        org = create_organization('Race', actor.pk)
        project = create_project(actor, org.pk, name='Race', description='', media=MEDIA, source=None)
        doc = empty_document()
        template = create_template(actor, org.pk, name='Template', fields=doc['styles'][0]['fields'], reference=doc['script'], source_label='')
        for target in ('template', 'project'):
            barrier = Barrier(2)
            def run(value):
                connections.close_all()
                try:
                    barrier.wait(timeout=10)
                    if target == 'template':
                        update_template(actor, org.pk, template['id'], revision=1, name=value, fields=template['fields'], reference=template['reference'], source_label='')
                    else:
                        change_styles(actor, org.pk, project.pk, 1, project.document,
                            {'type': 'update', 'id': project.document['styles'][0]['id'], 'name': value, 'fields': {}})
                    return 'ok'
                except (TemplateConflict, ProjectConflict):
                    return 'conflict'
                finally:
                    connections.close_all()
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = [pool.submit(run, value) for value in ('A', 'B')]
                self.assertCountEqual([r.result(timeout=15) for r in results], ['ok', 'conflict'])
        project.refresh_from_db()
        self.assertEqual(project.revision, 2)
        self.assertEqual(OrganizationStyleTemplate.objects.get(pk=template['id']).revision, 2)
