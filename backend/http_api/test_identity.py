from django.contrib import admin
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase
from accounts.models import User, PersonalSettings
from application.identity_admin import save_account
from organizations.models import Organization, OrganizationMembership as Membership
from organizations.services import create_organization, add_member, change_member

PASSWORD = 'test-only-long-password-927!'


class IdentityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('alice', password=PASSWORD)
        self.other = User.objects.create_user('bob', password=PASSWORD)
        self.dev = User.objects.create_superuser('dev', password=PASSWORD)
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')

    def send(self, path, data=None, method='POST', client=None):
        client = client or self.client
        return getattr(client, method.lower())('/api' + path, data or {}, content_type='application/json',
                                              HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)

    def login(self, user=None, client=None):
        return self.send('/auth/login', {'username': (user or self.user).username, 'password': PASSWORD}, client=client)

    def test_real_csrf_anonymous_login_and_rotation(self):
        token = self.client.cookies['csrftoken'].value
        for header in [{}, {'HTTP_X_CSRFTOKEN': 'x' * 32}]:
            response = self.client.post('/api/auth/login', {'username': 'alice', 'password': PASSWORD}, content_type='application/json', **header)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['error']['code'], 'csrf_failed')
        result = self.login()
        self.assertEqual(result.status_code, 200)
        self.assertNotEqual(token, self.client.cookies['csrftoken'].value)
        self.assertTrue(self.client.cookies['sessionid']['httponly'])
        self.assertNotIn('password', result.json()['user'])
        self.assertEqual(self.client.get('/api/auth/session').json()['user'], {'id': self.user.pk, 'username': 'alice', 'is_dev': False})
        self.assertEqual(self.client.get('/api/auth/logout').status_code, 405)
        self.assertEqual(self.send('/auth/logout').status_code, 200)
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])
        self.assertEqual(self.client.get('/api/me/settings').json()['error']['code'], 'authentication_required')

    def test_invalid_credentials_limit_and_inactive_session(self):
        for username in ['missing', 'alice']:
            response = self.send('/auth/login', {'username': username, 'password': 'wrong'})
            self.assertEqual(response.json()['error']['code'], 'invalid_credentials')
        self.login()
        self.user.is_active = False
        save_account(self.user)
        self.assertEqual(self.client.get('/api/organizations').status_code, 401)
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])
        for _ in range(10):
            self.send('/auth/login', {'username': 'alice', 'password': 'wrong'})
        self.assertEqual(self.send('/auth/login', {'username': 'alice', 'password': PASSWORD}).status_code, 429)

    def test_profile_is_read_only(self):
        for actor in [self.user, self.other, self.dev]:
            self.login(actor)
            self.assertEqual(self.client.get('/api/auth/me').json()['user'], {'id': actor.pk, 'username': actor.username, 'is_dev': actor.is_superuser})
            self.assertEqual(self.send('/auth/me', {'display_name': '中文名'}, 'PATCH').status_code, 405)
            actor.refresh_from_db()
            self.assertNotIn('display_name', {field.name for field in actor._meta.fields})

    def test_members_and_admin_use_username_without_display_name(self):
        org = create_organization('Username organization', self.user.pk)
        self.login()
        members = self.client.get(f'/api/organizations/{org.pk}/members').json()['members']
        self.assertEqual(members, [{
            'id': org.memberships.get().pk, 'user_id': self.user.pk,
            'username': 'alice', 'role': 'organizer', 'is_active': True,
        }])
        self.client.force_login(self.dev)
        for path in ['/admin/accounts/user/add/', f'/admin/accounts/user/{self.user.pk}/change/']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, 'name="display_name"')

    def test_password_confirmation_and_other_session_invalidation(self):
        self.login()
        other_client = Client(enforce_csrf_checks=True)
        other_client.get('/api/auth/session'); self.login(client=other_client)
        for values in [('bad', PASSWORD), (PASSWORD, '123')]:
            self.assertEqual(self.send('/auth/password', {'old_password': values[0], 'new_password': values[1], 'new_password_confirmation': values[1]}).status_code, 400)
        for confirmation in [None, PASSWORD, 123, 'x' * 1025]:
            data = {'old_password': PASSWORD, 'new_password': PASSWORD + '-new'}
            if confirmation is not None:
                data['new_password_confirmation'] = confirmation
            self.assertEqual(self.send('/auth/password', data).status_code, 400)
            self.user.refresh_from_db()
            self.assertTrue(self.user.check_password(PASSWORD))
            self.assertEqual(other_client.get('/api/auth/session').json()['user']['id'], self.user.pk)
        self.assertEqual(self.send('/auth/password', {'old_password': PASSWORD, 'new_password': PASSWORD + '-new', 'new_password_confirmation': PASSWORD + '-new'}).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['id'], self.user.pk)
        self.assertIsNone(other_client.get('/api/auth/session').json()['user'])
        # Missing CSRF is rejected even for already authenticated profile/password writes.
        for path in ['me', 'password', 'logout']:
            response = self.client.post('/api/auth/' + path, {}, content_type='application/json')
            self.assertEqual(response.json()['error']['code'], 'csrf_failed')

    def test_settings_isolation_restore_and_validation(self):
        self.login()
        initial = self.client.get('/api/me/settings').json()
        self.assertEqual(initial['shortcut_overrides'], {})
        self.assertEqual(initial['audio_display_mode'], 'spectrum')
        self.assertFalse(PersonalSettings.objects.exists())
        overrides = {'commit': ['Shift+KeyG', 'Enter', 'NumpadEnter']}
        self.assertEqual(self.send('/me/settings', {'shortcut_overrides': overrides}, 'PATCH').json()['shortcut_overrides'], overrides)
        self.assertEqual(self.client.get('/api/me/settings').json()['shortcut_overrides'], overrides)
        for invalid in [{'missing': []}, {'commit': ['KeyS']}, {'commit': ['KeyZ', 'KeyZ']}, {'commit': ['Ctrl+KeyL']}, {'commit': ['Escape']}, {'commit': ['Shift+Space']}, {'commit': 'KeyG'}]:
            self.assertEqual(self.send('/me/settings', {'shortcut_overrides': invalid}, 'PATCH').status_code, 400, invalid)
        self.assertEqual(self.send('/me/settings', {'shortcut_overrides': {}, 'user_id': self.other.pk}, 'PATCH').status_code, 400)
        self.send('/me/settings', {'shortcut_overrides': {'commit': initial['defaults']['commit']['bindings']}}, 'PATCH')
        self.assertEqual(self.client.get('/api/me/settings').json()['shortcut_overrides'], {})
        self.login(self.other)
        self.assertEqual(self.client.get('/api/me/settings').json()['shortcut_overrides'], {})
        self.assertFalse(PersonalSettings.objects.filter(user=self.other).exists())

    def test_delete_shortcut_override_persistence_validation_and_restore(self):
        self.login()
        initial = self.client.get('/api/me/settings').json()
        defaults = ['Ctrl+Delete', 'Meta+Delete', 'Ctrl+Backspace', 'Meta+Backspace']
        self.assertEqual(initial['defaults']['delete-row']['bindings'], defaults)
        for bindings in [defaults, ['Shift+KeyX'], [], ['Meta+Backspace']]:
            overrides = {'delete-row': bindings}
            expected = {} if bindings == defaults else overrides
            response = self.send('/me/settings', {'shortcut_overrides': overrides}, 'PATCH')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['shortcut_overrides'], expected)
            self.assertEqual(self.client.get('/api/me/settings').json()['shortcut_overrides'], expected)
        for invalid in [
            {'delete-row': ['Delete']}, {'delete-row': ['Backspace']},
            {'delete-row': ['Ctrl+KeyX']}, {'delete-row': ['Ctrl+Meta+Delete']},
            {'delete-row': ['Shift+Meta+Backspace']}, {'delete-row': ['Alt+Delete']},
            {'delete-row': ['KeyG']}, {'delete-row': ['KeyX', 'KeyX']},
            {'commit': ['Meta+Delete']}, {'commit': ['KeyX'], 'delete-row': ['KeyX']},
        ]:
            self.assertEqual(self.send('/me/settings', {'shortcut_overrides': invalid}, 'PATCH').status_code, 400, invalid)
            self.assertEqual(self.client.get('/api/me/settings').json()['shortcut_overrides'], {'delete-row': ['Meta+Backspace']})
        for overrides in [{'delete-row': defaults}, {}]:
            response = self.send('/me/settings', {'shortcut_overrides': overrides}, 'PATCH')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['shortcut_overrides'], {})

    def test_audio_display_settings_are_partial_validated_and_account_scoped(self):
        self.login()
        overrides = {'commit': ['Shift+KeyT']}
        self.assertEqual(self.send('/me/settings', {'shortcut_overrides': overrides}, 'PATCH').status_code, 200)
        changed = self.send('/me/settings', {'audio_display_mode': 'waveform'}, 'PATCH').json()
        self.assertEqual(changed['audio_display_mode'], 'waveform')
        self.assertEqual(changed['shortcut_overrides'], overrides)
        with self.assertRaises(IntegrityError), transaction.atomic():
            PersonalSettings.objects.filter(user=self.user).update(audio_display_mode='invalid')
        self.assertEqual(self.client.get('/api/me/settings').json()['audio_display_mode'], 'waveform')
        self.assertEqual(self.send('/me/settings', {'shortcut_overrides': {}}, 'PATCH').json()['audio_display_mode'], 'waveform')
        for invalid in ['Waveform', 'unknown', '', None, True, 1, [], {}]:
            response = self.send('/me/settings', {'audio_display_mode': invalid, 'shortcut_overrides': overrides}, 'PATCH')
            self.assertEqual(response.status_code, 400, invalid)
            current = self.client.get('/api/me/settings').json()
            self.assertEqual(current['audio_display_mode'], 'waveform')
            self.assertEqual(current['shortcut_overrides'], {})
        for invalid in [{}, {'audio_display_mode': 'spectrum', 'user_id': self.other.pk}]:
            self.assertEqual(self.send('/me/settings', invalid, 'PATCH').status_code, 400)
        self.login(self.other)
        self.assertEqual(self.client.get('/api/me/settings').json()['audio_display_mode'], 'spectrum')
        self.assertFalse(PersonalSettings.objects.filter(user=self.other).exists())
        self.login()
        restored = self.send('/me/settings', {'audio_display_mode': 'spectrum', 'shortcut_overrides': overrides}, 'PATCH').json()
        self.assertEqual(restored['audio_display_mode'], 'spectrum')
        self.assertEqual(restored['shortcut_overrides'], overrides)

    def test_roles_scope_fields_uniqueness_and_dev(self):
        a = create_organization('A', self.user.pk)
        b = create_organization('B', self.other.pk)
        member = add_member(self.other, b.pk, self.user.username)
        self.login()
        orgs = self.client.get('/api/organizations').json()['organizations']
        self.assertEqual([org['role'] for org in orgs], ['organizer', 'member'])
        self.assertEqual(self.client.get(f'/api/organizations/{b.pk}/members').status_code, 200)
        for suffix, data, method in [('', {'name': 'wrong'}, 'PATCH'), ('/members', {'username': 'dev'}, 'POST'), (f'/members/{member.pk}', {'role': 'organizer'}, 'PATCH')]:
            self.assertEqual(self.send(f'/organizations/{b.pk}{suffix}', data, method).json()['error']['code'], 'permission_denied')
        self.assertEqual(self.send(f'/organizations/{a.pk}', {'name': 'A2'}, 'PATCH').status_code, 200)
        for data in [{'username': 'bob', 'is_staff': True}, {'user_id': self.other.pk}, {'username': 'bob', 'role': 'organizer'}]:
            self.assertEqual(self.send(f'/organizations/{a.pk}/members', data).status_code, 400)
        self.assertEqual(self.send(f'/organizations/{a.pk}/members', {'username': 'bob'}).status_code, 200)
        self.assertEqual(self.send(f'/organizations/{a.pk}/members/{member.pk}', {'role': 'member'}, 'PATCH').status_code, 404)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Membership.objects.create(organization=b, user=self.user, role='member')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Membership.objects.create(organization=b, user=self.dev, role='dev')
        self.send(f'/organizations/{a.pk}/members/{a.memberships.get(user=self.other).pk}', {}, 'DELETE')
        self.assertTrue(User.objects.filter(pk=self.other.pk).exists())
        self.assertTrue(Membership.objects.filter(pk=member.pk).exists())
        stranger = User.objects.create_user('stranger', password=PASSWORD, is_staff=True)
        self.login(stranger)
        self.assertEqual(self.client.get(f'/api/organizations/{a.pk}').status_code, 403)
        self.assertEqual(self.client.get('/api/organizations').json()['organizations'], [])
        self.login(self.dev)
        self.assertTrue(all(org['can_manage'] for org in self.client.get('/api/organizations').json()['organizations']))
        self.assertFalse(Membership.objects.filter(user=self.dev).exists())
        self.assertEqual(self.send(f'/organizations/{a.pk}', {'name': 'dev renamed'}, 'PATCH').status_code, 200)

    def test_organizers_cannot_remove_or_demote_each_other(self):
        org = create_organization('peers', self.user.pk)
        peer = add_member(self.dev, org.pk, self.other.username)
        change_member(self.user, org.pk, peer.pk, role='organizer')
        first = org.memberships.get(user=self.user)
        for actor, target in [(self.user, peer), (self.other, first)]:
            self.login(actor)
            for data, method in [({}, 'DELETE'), ({'role': 'member'}, 'PATCH')]:
                self.assertEqual(self.send(f'/organizations/{org.pk}/members/{target.pk}', data, method).status_code, 403)
                target.refresh_from_db()
                self.assertEqual(target.role, 'organizer')
            with self.assertRaises(PermissionDenied):
                change_member(actor, org.pk, target.pk)
        # Leaving oneself remains supported; the last organizer is still protected.
        self.assertEqual(self.send(f'/organizations/{org.pk}/leave').status_code, 200)
        self.assertFalse(Membership.objects.filter(pk=peer.pk).exists())
        peer = add_member(self.dev, org.pk, self.other.username)
        change_member(self.dev, org.pk, peer.pk, role='organizer')
        self.login(self.dev)
        self.assertEqual(self.send(f'/organizations/{org.pk}/members/{peer.pk}', {}, 'DELETE').status_code, 200)
        self.assertEqual(self.send(f'/organizations/{org.pk}/members/{first.pk}', {}, 'DELETE').status_code, 400)

    def test_last_active_organizer_all_supported_entries(self):
        org = create_organization('A', self.user.pk)
        membership = org.memberships.get()
        self.login()
        for suffix, data, method in [(f'/members/{membership.pk}', {'role': 'member'}, 'PATCH'), (f'/members/{membership.pk}', {}, 'DELETE'), ('/leave', {}, 'POST')]:
            self.assertEqual(self.send(f'/organizations/{org.pk}{suffix}', data, method).status_code, 400)
            self.assertTrue(Membership.objects.filter(pk=membership.pk, role='organizer').exists())
        self.user.is_active = False
        with self.assertRaises(ValidationError):
            save_account(self.user)
        self.user.refresh_from_db(); self.assertTrue(self.user.is_active)
        self.other.is_active = False; save_account(self.other)
        with self.assertRaises(ValidationError):
            create_organization('incomplete', self.other.pk)
        self.assertFalse(Organization.objects.filter(name='incomplete').exists())
        # Actual Admin POST must roll back deactivation and display an error.
        self.client.force_login(self.dev)
        response = self.send_admin_user_change(self.user)
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db(); self.assertTrue(self.user.is_active)
        request = type('Request', (), {'user': self.dev})()
        self.assertFalse(admin.site._registry[User].has_delete_permission(request, self.user))
        self.assertFalse(admin.site._registry[Membership].has_change_permission(request, membership))
        with self.assertRaises(ValidationError): self.user.delete()

    def send_admin_user_change(self, user):
        return self.client.post(f'/admin/accounts/user/{user.pk}/change/', {
            'username': user.username, 'first_name': '', 'last_name': '', 'email': '',
            'date_joined_0': '2026-10-23', 'date_joined_1': '00:00:00', '_save': 'Save',
        }, HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_ass_remains_public_with_csrf_client_and_expired_session(self):
        self.login(); self.send('/auth/logout')
        empty = self.client.get('/api/ass/empty').json()['document']
        self.assertEqual(self.client.post('/api/ass/export', {'document': empty}, content_type='application/json').status_code, 200)

    def test_other_tab_account_switch_cannot_write_wrong_settings(self):
        self.login(self.other)
        response = self.client.patch('/api/me/settings', {'shortcut_overrides': {'commit': []}}, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_CUERELAY_USER=str(self.user.pk))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'account_changed')
        self.assertFalse(PersonalSettings.objects.filter(user=self.other).exists())


    def test_admin_creation_and_member_table_are_guarded(self):
        self.client.force_login(self.dev)
        response = self.client.post('/admin/organizations/organization/add/', {
            'name': 'Admin 创建组织', 'initial_organizer': self.user.pk, '_save': 'Save',
        }, HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code, 302)
        org = Organization.objects.get(name='Admin 创建组织')
        self.assertEqual(org.memberships.get().user, self.user)
        member = org.memberships.get()
        response = self.client.post(f'/admin/organizations/organizationmembership/{member.pk}/change/', {
            'role': 'member', '_save': 'Save',
        }, HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code, 403)
        member.refresh_from_db(); self.assertEqual(member.role, 'organizer')
        self.user.is_staff = True; self.user.save(update_fields=['is_staff'])
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(f'/admin/accounts/user/{self.other.pk}/change/').status_code, 403)

    def test_inactive_organizer_does_not_satisfy_last_organizer_rule(self):
        org = create_organization('active rule', self.user.pk)
        secondary = add_member(self.dev, org.pk, self.other.username)
        change_member(self.dev, org.pk, secondary.pk, role='organizer')
        self.other.is_active = False; save_account(self.other)
        last = org.memberships.get(user=self.user)
        with self.assertRaises(ValidationError):
            change_member(self.dev, org.pk, last.pk, role='member')
        self.assertTrue(Membership.objects.filter(pk=last.pk, role='organizer').exists())
