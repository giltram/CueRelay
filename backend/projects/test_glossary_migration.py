"""Existing projects gain only an empty, independently versioned association."""
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from accounts.models import User
from ass_format import empty_document
from organizations.services import create_organization
from glossary.models import Glossary
from projects.models import Project
from projects.services import save_document


class GlossaryMigrationTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        executor.migrate([('projects', '0002_document_styles_v2')])
        executor = MigrationExecutor(connection)
        self.old_apps = executor.loader.project_state(list(executor.loader.applied_migrations)).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def test_existing_snapshot_and_save_contract_survive_without_empty_tables(self):
        actor = User.objects.create_user('glossary-migration')
        org = create_organization('Existing', actor.pk)
        document = empty_document()
        document['cues'] = [{'id': 'new-existing', 'text': '原字幕', 'start_ms': 0, 'end_ms': 1000, 'style_id': document['styles'][0]['id']}]
        old = self.old_apps.get_model('projects', 'Project').objects.create(organization_id=org.pk, name='Video',
            document=document, media={'sha256': 'a'*64, 'size': 100, 'duration_ms': 4000}, revision=7,
            created_by_id=actor.pk, updated_by_id=actor.pk)
        MigrationExecutor(connection).migrate(self.latest)
        project = Project.objects.get(pk=old.pk)
        self.assertEqual((project.document, project.media, project.revision, project.updated_at, project.updated_by_id),
                         (old.document, old.media, 7, old.updated_at, old.updated_by_id))
        self.assertIsNone(project.glossary_id)
        self.assertEqual(project.glossary_version, 1)
        self.assertFalse(Glossary.objects.exists())
        document['cues'][0]['text'] = '迁移后编辑'
        saved = save_document(actor, org.pk, project.pk, 7, document)
        self.assertEqual(saved.revision, 8)
        self.assertEqual(saved.document['cues'][0]['text'], '迁移后编辑')


class ExistingGlossaryAssociationMigrationTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        executor.migrate([('projects', '0003_glossary_association')])
        migrated = MigrationExecutor(connection)
        self.old_apps = migrated.loader.project_state(list(migrated.loader.applied_migrations)).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def test_existing_project_tables_and_ids_are_not_merged_into_default(self):
        from glossary.models import Entry
        from projects.glossary_services import read_context, save_organization_entry
        actor = User.objects.create_user('existing-glossary')
        org = create_organization('Existing', actor.pk)
        table = Glossary.objects.create(organization=org, name='Old private table', created_by=actor)
        entry = Entry.objects.create(glossary=table, original='Existing', translation='原译名', updated_by=actor)
        old = self.old_apps.get_model('projects', 'Project').objects.create(organization_id=org.pk, name='Video', document=empty_document(),
            media={'sha256': 'a'*64, 'size': 100, 'duration_ms': 4000}, revision=7,
            glossary_id=table.pk, glossary_version=2, glossary_auto_created=True, created_by_id=actor.pk, updated_by_id=actor.pk)
        MigrationExecutor(connection).migrate(self.latest)
        project = Project.objects.get(pk=old.pk)
        self.assertEqual(project.glossary_id, table.pk)
        self.assertEqual(project.glossary_version, 2)
        self.assertEqual(project.revision, 7)
        self.assertEqual(read_context(actor, org.pk, project.pk)['entries'][0]['id'], str(entry.pk))
        self.assertFalse(read_context(actor, org.pk, project.pk)['uses_organization_default'])
        saved = save_organization_entry(actor, org.pk, association_version=1, glossary_id=None, original='New', translation='组织词条', note='')
        self.assertNotEqual(saved['table']['id'], str(table.pk))
        self.assertEqual(read_context(actor, org.pk, project.pk)['total'], 1)
        self.assertEqual(read_context(actor, org.pk, project.pk)['entries'][0]['translation'], '原译名')
