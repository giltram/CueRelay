"""Apply the actual additive migration to existing organization and project rows."""
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from accounts.models import User
from ass_format import empty_document
from projects.models import Project
from .models import Organization
from .permissions import DEFAULT_MEMBER_PERMISSIONS
from .services import effective_permissions


class MemberPermissionMigrationTests(TransactionTestCase):
    def test_existing_data_and_default_behavior_survive_additive_migration(self):
        executor = MigrationExecutor(connection)
        target = [('organizations', '0002_organizationstyletemplate')]
        executor.migrate(target)
        try:
            old = executor.loader.project_state(target).apps
            organizer = User.objects.create_user('old-organizer')
            member = User.objects.create_user('old-member')
            org = old.get_model('organizations', 'Organization').objects.create(name='Existing')
            Membership = old.get_model('organizations', 'OrganizationMembership')
            Membership.objects.create(organization_id=org.pk, user_id=organizer.pk, role='organizer')
            Membership.objects.create(organization_id=org.pk, user_id=member.pk, role='member')
            document = empty_document()
            project = Project.objects.create(organization_id=org.pk, name='Existing project', description='Keep',
                document=document, media={'sha256': 'a' * 64, 'size': 10, 'duration_ms': 1000}, created_by=organizer, updated_by=organizer)
            before = Project.objects.get(pk=project.pk).__dict__.copy(); before.pop('_state')
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
        migrated = Organization.objects.get(pk=org.pk)
        self.assertEqual(migrated.member_permissions, {})
        self.assertEqual(migrated.permissions_revision, 1)
        self.assertEqual(effective_permissions(member, migrated), DEFAULT_MEMBER_PERMISSIONS)
        after = Project.objects.get(pk=project.pk).__dict__.copy(); after.pop('_state')
        self.assertEqual(after, before)
        self.assertEqual(migrated.memberships.count(), 2)
        new = Organization.objects.create(name='New')
        self.assertEqual(new.member_permissions, {})
        self.assertEqual(new.permissions_revision, 1)
