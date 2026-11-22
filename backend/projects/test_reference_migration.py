from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from accounts.models import User
from organizations.services import create_organization
from ass_format import empty_document
from projects.models import Project
from projects.reference_services import replace_reference


class ReferenceMigrationTests(TransactionTestCase):
    def test_old_project_gets_null_reference_and_can_upload_after_migration(self):
        actor = User.objects.create_user('ref-old')
        org = create_organization('Old', actor.pk)
        executor = MigrationExecutor(connection)
        target = [('projects', '0004_remove_project_glossary_auto_created')]
        executor.migrate(target)
        try:
            old = executor.loader.project_state(target).apps.get_model('projects', 'Project')
            project = old.objects.create(organization_id=org.pk, name='Old', description='Keep', document=empty_document(),
                media={'sha256': 'b'*64, 'size': 1, 'duration_ms': 1000}, created_by_id=actor.pk, updated_by_id=actor.pk)
            before = {key: value for key, value in project.__dict__.items() if key != '_state'}
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
        project = Project.objects.get(pk=project.pk)
        self.assertIsNone(project.reference_cues)
        self.assertEqual(project.reference_version, 1)
        self.assertEqual({key: getattr(project, key) for key in before}, before)
        replace_reference(actor, org.pk, project.pk, version=1, source='1\n00:00:00,001 --> 00:00:00,002\nx')
        project.refresh_from_db()
        self.assertEqual(project.reference_cues[0]['start_ms'], 1)
        self.assertEqual(project.revision, before['revision'])
