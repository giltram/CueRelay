"""Exercise the actual RunPython function against existing snapshots and rollback."""
from copy import deepcopy
from importlib import import_module
from io import StringIO
import json
from pathlib import Path
from types import SimpleNamespace
from django.apps import apps
from django.db import connection, transaction
from django.core.management import call_command, CommandError
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from accounts.models import User
from organizations.services import create_organization
from ass_format import serialize_ass
from .models import Project
from .services import create_project

upgrade = import_module('projects.migrations.0002_document_styles_v2').upgrade
FIXTURES = Path(__file__).resolve().parent.parent / 'ass_format' / 'fixtures' / 'legacy-v1'


def legacy_fixture(name):
    return json.loads((FIXTURES / f'{name}.json').read_text())


class SnapshotMigrationTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user('migration-organizer')
        self.org = create_organization('Migration', self.actor.pk)
        self.project = create_project(self.actor, self.org.pk, name='Existing', description='',
            media={'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}, source=None)
        self.legacy = {'source': self.project.document['source'], 'styles': ['Default'],
            'cues': [{'id': 'new-saved', 'start_ms': 0, 'end_ms': 1000, 'text': '既有字幕', 'style': 'Default'}]}
        Project.objects.filter(pk=self.project.pk).update(document=self.legacy)

    def test_saved_document_migrates_without_touching_revision_media_or_actor(self):
        before = deepcopy(self.project.media)
        timestamp = self.project.updated_at
        upgrade(apps, SimpleNamespace(connection=connection))
        self.project.refresh_from_db()
        self.assertEqual(self.project.document['schema_version'], 2)
        self.assertEqual(self.project.document['source'], self.legacy['source'])
        self.assertEqual(self.project.document['cues'][0]['id'], 'new-saved')
        self.assertEqual(self.project.document['cues'][0]['style_id'], self.project.document['styles'][0]['id'])
        self.assertEqual(self.project.media, before)
        self.assertEqual(self.project.revision, 1)
        self.assertEqual(self.project.updated_at, timestamp)
        self.assertEqual(self.project.updated_by, self.actor)
        self.assertIn('既有字幕', serialize_ass(self.project.document))

    def test_bad_snapshot_stops_and_transaction_rolls_back_other_upgrades(self):
        other = Project.objects.create(organization=self.org, name='Bad snapshot', description='', media=self.project.media,
            document={**self.legacy, 'styles': ['missing']}, created_by=self.actor, updated_by=self.actor)
        with self.assertRaisesRegex(RuntimeError, f'project {other.pk}'), transaction.atomic():
            upgrade(apps, SimpleNamespace(connection=connection))
        self.project.refresh_from_db(); other.refresh_from_db()
        self.assertEqual(self.project.document, self.legacy)
        self.assertEqual(other.document['styles'], ['missing'])

    def test_read_only_preflight_reports_every_incompatible_project(self):
        projects = [self.project]
        for name in ['leading-zero-playres', 'long-style-name', 'duplicate-playres']:
            projects.append(Project.objects.create(organization=self.org, name=name, media=self.project.media,
                document=legacy_fixture(name), created_by=self.actor, updated_by=self.actor))
        current = create_project(self.actor, self.org.pk, name='Current', description='', media=self.project.media, source=None)
        projects.append(current)
        before = list(Project.objects.order_by('pk').values())
        output = StringIO()
        with CaptureQueriesContext(connection) as queries:
            with self.assertRaises(CommandError):
                call_command('check_style_migration', stdout=output)
        for project in projects[1:-1]:
            self.assertIn(f'project {project.pk}:', output.getvalue())
        self.assertIn('Compatible v1: 1; valid v2: 1; incompatible: 3', output.getvalue())
        self.assertTrue(queries.captured_queries)
        # PostgreSQL iterator() uses a read-only server cursor (DECLARE ... FOR
        # SELECT); query capture records its declaration rather than just SELECT.
        for query in queries:
            sql = query['sql'].lstrip().upper()
            self.assertTrue(sql.startswith('SELECT') or (sql.startswith('DECLARE ') and ' FOR SELECT ' in sql), sql)
        self.assertEqual(list(Project.objects.order_by('pk').values()), before)

    def test_preflight_success_does_not_apply_upgrade(self):
        output = StringIO()
        call_command('check_style_migration', stdout=output)
        self.assertIn('Compatible v1: 1; valid v2: 0; incompatible: 0', output.getvalue())
        self.project.refresh_from_db()
        self.assertEqual(self.project.document, self.legacy)


class HistoricalMigrationExecutorTests(TransactionTestCase):
    """Run the real atomic migration from v1 state with fixed historical data."""

    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        # 0002 is irreversible and data-only. The test DB is empty here; only
        # unrecord its application, then insert v1 fixtures before real migrate.
        executor.migrate([('projects', '0001_initial')], fake=True)
        targets = [target for target in self.latest if target[0] != 'projects'] + [('projects', '0001_initial')]
        old_apps = MigrationExecutor(connection).loader.project_state(targets).apps
        self.OldProject = old_apps.get_model('projects', 'Project')
        self.actor = User.objects.create_user('historical-migration')
        self.org = create_organization('Historical', self.actor.pk)

    def tearDown(self):
        # Remove incompatible test fixtures so restoring the latest state cannot
        # fail and affect other tests. No development database is involved.
        Project.objects.all().delete()
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def create_snapshot(self, name):
        return self.OldProject.objects.create(organization_id=self.org.pk, name=name, document=legacy_fixture(name),
            media={'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}, revision=7,
            created_by_id=self.actor.pk, updated_by_id=self.actor.pk)

    def test_actual_migration_preserves_metadata_and_historical_cue_ids(self):
        project = self.create_snapshot('valid')
        before = self.OldProject.objects.values().get(pk=project.pk)
        MigrationExecutor(connection).migrate(self.latest)
        after = Project.objects.values().get(pk=project.pk)
        self.assertEqual({key: value for key, value in after.items() if key != 'document'},
                         {key: value for key, value in before.items() if key != 'document'})
        self.assertEqual(after['document']['source'], before['document']['source'])
        self.assertEqual(after['document']['cues'][0]['id'], before['document']['cues'][0]['id'])
        self.assertEqual(serialize_ass(after['document']), before['document']['source'])

    def test_each_incompatible_history_rolls_back_mixed_projects_and_migration_record(self):
        for name in ['leading-zero-playres', 'long-style-name', 'duplicate-playres']:
            good = self.create_snapshot('valid')
            bad = self.create_snapshot(name)
            before = list(self.OldProject.objects.order_by('pk').values())
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, f'project {bad.pk}'):
                MigrationExecutor(connection).migrate(self.latest)
            self.assertEqual(list(self.OldProject.objects.order_by('pk').values()), before)
            self.assertNotIn(('projects', '0002_document_styles_v2'), MigrationRecorder(connection).applied_migrations())
            self.OldProject.objects.filter(pk__in=[good.pk, bad.pk]).delete()
