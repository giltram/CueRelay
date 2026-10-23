"""Upgrade existing accounts without changing identity or owned resources."""
from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from accounts.models import User


class UsernameOnlyMigrationTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        self.before = [('accounts', '0002_loginattempt')]
        executor.migrate(self.before)
        self.old_apps = executor.loader.project_state(self.before + [
            ('organizations', '0001_initial'), ('projects', '0001_initial'),
        ]).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def test_remove_display_name_preserves_account_session_and_resource_ownership(self):
        OldUser = self.old_apps.get_model('accounts', 'User')
        password = 'existing-migration-password-927!'
        old_user = OldUser.objects.create(username='existing-account', display_name='旧显示名', password=make_password(password), is_staff=True)
        old_settings = self.old_apps.get_model('accounts', 'PersonalSettings').objects.create(
            user_id=old_user.pk, shortcut_overrides={'commit': ['Shift+KeyT']})
        old_org = self.old_apps.get_model('organizations', 'Organization').objects.create(name='Existing organization')
        membership = self.old_apps.get_model('organizations', 'OrganizationMembership').objects.create(
            user_id=old_user.pk, organization_id=old_org.pk, role='organizer')
        document = {'source': 'retained source', 'cues': [{'text': '保留字幕'}]}
        project = self.old_apps.get_model('projects', 'Project').objects.create(
            organization_id=old_org.pk, name='Existing project', document=document,
            media={'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000},
            created_by_id=old_user.pk, updated_by_id=old_user.pk)
        self.client.force_login(User.objects.get(pk=old_user.pk))
        session_key = self.client.session.session_key

        executor = MigrationExecutor(connection)
        executor.migrate(self.latest)
        apps = executor.loader.project_state(self.latest).apps
        migrated_user = User.objects.get(pk=old_user.pk)
        self.assertNotIn('display_name', {field.name for field in migrated_user._meta.fields})
        self.assertEqual(migrated_user.username, old_user.username)
        self.assertEqual(migrated_user.password, old_user.password)
        self.assertTrue(migrated_user.check_password(password))
        self.assertTrue(migrated_user.is_staff)
        self.assertEqual(apps.get_model('accounts', 'PersonalSettings').objects.get(pk=old_settings.pk).shortcut_overrides, {'commit': ['Shift+KeyT']})
        self.assertEqual(apps.get_model('organizations', 'OrganizationMembership').objects.get(pk=membership.pk).user_id, old_user.pk)
        migrated_project = apps.get_model('projects', 'Project').objects.get(pk=project.pk)
        self.assertEqual((migrated_project.created_by_id, migrated_project.updated_by_id), (old_user.pk, old_user.pk))
        self.assertEqual(migrated_project.document, document)
        self.assertEqual(self.client.session.session_key, session_key)
        self.assertEqual(self.client.get('/api/auth/session').json()['user'], {
            'id': old_user.pk, 'username': old_user.username, 'is_dev': False,
        })
