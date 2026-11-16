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
        # Other apps may have later schema migrations independent of accounts.
        # Build models for the actual applied state, not a frozen project schema.
        migrated = MigrationExecutor(connection)
        self.old_apps = migrated.loader.project_state(list(migrated.loader.applied_migrations)).apps

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
        # The new onboarding column does not exist until the latest migration.
        self.client.force_login(User.objects.defer('handbook_seen').get(pk=old_user.pk))
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
        self.assertTrue(migrated_user.handbook_seen)
        self.assertEqual(apps.get_model('accounts', 'PersonalSettings').objects.get(pk=old_settings.pk).shortcut_overrides, {'commit': ['Shift+KeyT']})
        self.assertEqual(apps.get_model('accounts', 'PersonalSettings').objects.get(pk=old_settings.pk).audio_display_mode, 'spectrum')
        self.assertIs(apps.get_model('accounts', 'PersonalSettings').objects.get(pk=old_settings.pk).mouse_sets_cue_boundary, True)
        self.assertEqual(apps.get_model('organizations', 'OrganizationMembership').objects.get(pk=membership.pk).user_id, old_user.pk)
        migrated_project = apps.get_model('projects', 'Project').objects.get(pk=project.pk)
        self.assertEqual((migrated_project.created_by_id, migrated_project.updated_by_id), (old_user.pk, old_user.pk))
        self.assertEqual(migrated_project.document, document)
        self.assertEqual(self.client.session.session_key, session_key)
        self.assertEqual(self.client.get('/api/auth/session').json()['user'], {
            'id': old_user.pk, 'username': old_user.username, 'is_dev': False,
        })


class HandbookMigrationTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        self.before = [('accounts', '0005_personalsettings_mouse_sets_cue_boundary')]
        executor.migrate(self.before)
        self.old_apps = executor.loader.project_state(self.before).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def test_only_previously_logged_in_users_skip_the_prompt(self):
        from django.utils import timezone
        OldUser = self.old_apps.get_model('accounts', 'User')
        experienced = OldUser.objects.create(username='experienced', last_login=timezone.now(), password='retained-hash')
        invited = OldUser.objects.create(username='never-logged-in', password='another-hash')
        OldSettings = self.old_apps.get_model('accounts', 'PersonalSettings')
        OldSettings.objects.create(user_id=experienced.pk, audio_display_mode='waveform', mouse_sets_cue_boundary=False,
                                   shortcut_overrides={'commit': ['Shift+KeyT']})
        MigrationExecutor(connection).migrate(self.latest)
        self.assertTrue(User.objects.get(pk=experienced.pk).handbook_seen)
        self.assertFalse(User.objects.get(pk=invited.pk).handbook_seen)
        self.assertFalse(User.objects.create_user('new-after-upgrade').handbook_seen)
        self.assertEqual(User.objects.get(pk=experienced.pk).password, 'retained-hash')
        settings = OldSettings.objects.get(user_id=experienced.pk)
        self.assertEqual(settings.shortcut_overrides, {'commit': ['Shift+KeyT']})
        self.assertEqual(settings.audio_display_mode, 'waveform')
        self.assertFalse(settings.mouse_sets_cue_boundary)


class LanguagePreferenceMigrationTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        self.latest = executor.loader.graph.leaf_nodes()
        self.before = [('accounts', '0006_user_handbook_seen')]
        executor.migrate(self.before)
        self.old_apps = executor.loader.project_state(self.before).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest)
        super().tearDown()

    def test_add_language_preserves_existing_settings_and_does_not_create_missing_rows(self):
        OldUser = self.old_apps.get_model('accounts', 'User')
        OldSettings = self.old_apps.get_model('accounts', 'PersonalSettings')
        existing = OldUser.objects.create(username='language-upgrade', password='retained-hash', handbook_seen=True)
        missing = OldUser.objects.create(username='language-no-settings', password='another-retained-hash')
        before = OldSettings.objects.create(user_id=existing.pk, audio_display_mode='waveform', mouse_sets_cue_boundary=False,
                                            shortcut_overrides={'commit': ['Shift+KeyT']})
        updated_at = before.updated_at
        MigrationExecutor(connection).migrate(self.latest)
        from accounts.models import PersonalSettings
        after = PersonalSettings.objects.get(user_id=existing.pk)
        self.assertEqual(after.language_preference, 'system')
        self.assertEqual(after.shortcut_overrides, before.shortcut_overrides)
        self.assertEqual(after.audio_display_mode, 'waveform')
        self.assertFalse(after.mouse_sets_cue_boundary)
        self.assertEqual(after.updated_at, updated_at)
        self.assertFalse(PersonalSettings.objects.filter(user_id=missing.pk).exists())
        self.assertEqual(User.objects.get(pk=existing.pk).password, 'retained-hash')
