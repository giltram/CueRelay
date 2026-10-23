"""These races require PostgreSQL row locks; SQLite is intentionally unsupported."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.core.exceptions import ValidationError
from django.db import connection, connections
from django.test import TransactionTestCase
from accounts.models import User
from application.identity_admin import save_account
from .models import OrganizationMembership as Membership
from .services import create_organization, add_member, change_member


class OrganizerConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.dev = User.objects.create_superuser('dev')
        self.a = User.objects.create_user('a')
        self.b = User.objects.create_user('b')
        self.org = create_organization('race', self.a.pk)
        member = add_member(self.dev, self.org.pk, 'b')
        change_member(self.dev, self.org.pk, member.pk, role='organizer')

    def race(self, action_a, action_b):
        barrier = Barrier(2)
        def run(action):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                action()
                return 'ok'
            except ValidationError:
                return 'protected'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run, action) for action in [action_a, action_b]]
            results = [future.result(timeout=15) for future in futures]
        self.assertCountEqual(results, ['ok', 'protected'])
        self.assertEqual(Membership.objects.filter(organization=self.org, role='organizer', user__is_active=True).count(), 1)

    def test_concurrent_demotions(self):
        def demote(user):
            member = Membership.objects.get(organization=self.org, user=user)
            change_member(self.dev, self.org.pk, member.pk, role='member')
        self.race(lambda: demote(self.a), lambda: demote(self.b))

    def test_concurrent_removals(self):
        def remove(user):
            member = Membership.objects.get(organization=self.org, user=user)
            change_member(self.dev, self.org.pk, member.pk)
        self.race(lambda: remove(self.a), lambda: remove(self.b))

    def test_concurrent_leaves(self):
        self.race(lambda: change_member(self.a, self.org.pk, leave=True), lambda: change_member(self.b, self.org.pk, leave=True))

    def test_deactivation_competes_with_removal(self):
        member = Membership.objects.get(organization=self.org, user=self.b)
        def deactivate():
            self.a.is_active = False
            save_account(self.a)
        self.race(deactivate, lambda: change_member(self.dev, self.org.pk, member.pk))

    def test_concurrent_deactivations(self):
        def deactivate(user):
            user.is_active = False
            save_account(user)
        self.race(lambda: deactivate(self.a), lambda: deactivate(self.b))
