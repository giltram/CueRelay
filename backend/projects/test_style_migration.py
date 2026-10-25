"""Exercise the actual RunPython function against existing snapshots and rollback."""
from copy import deepcopy
from importlib import import_module
from types import SimpleNamespace
from django.apps import apps
from django.db import connection, transaction
from django.test import TestCase
from accounts.models import User
from organizations.services import create_organization
from ass_format import serialize_ass
from .models import Project
from .services import create_project

upgrade = import_module('projects.migrations.0002_document_styles_v2').upgrade


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
