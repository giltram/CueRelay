"""Password policy and actual HTTP/authenticate integration, on PostgreSQL."""
import hashlib
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import authenticate, aauthenticate
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from .models import LoginAttempt, User

PASSWORD = 'violetmeadowqzx'  # 15 lowercase characters; no composition requirement.
FAST_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']


@override_settings(PASSWORD_HASHERS=FAST_HASHERS)
class PasswordPolicyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('alice', password='oldshort')
        self.dev = User.objects.create_superuser('dev', password=PASSWORD)
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')

    def post(self, path, data, json=True):
        kwargs = {'content_type': 'application/json'} if json else {}
        return self.client.post(path, data, HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, **kwargs)

    def test_real_api_legacy_password_and_new_length_boundary(self):
        self.assertEqual(self.post('/api/auth/login', {'username': 'alice', 'password': 'oldshort'}).status_code, 200)
        for old, new in [('wrong', PASSWORD), ('oldshort', PASSWORD[:-1]), ('oldshort', 'x' * 1025)]:
            with self.subTest(old=old, length=len(new)):
                self.assertEqual(self.post('/api/auth/password', {'old_password': old, 'new_password': new}).status_code, 400)
                self.user.refresh_from_db()
                self.assertTrue(self.user.check_password('oldshort'))
        self.assertEqual(self.post('/api/auth/password', {'old_password': 'oldshort', 'new_password': PASSWORD}).status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['id'], self.user.pk)
        self.assertEqual(self.post('/api/auth/password', {'old_password': PASSWORD, 'new_password': 'x' * 1024}).status_code, 200)

    def test_validators_preserve_weak_numeric_and_identity_checks(self):
        validate_password(PASSWORD, self.user)
        validate_password('x' * 1024, self.user)
        for candidate, code in [(PASSWORD[:-1], 'password_too_short'), ('x' * 1025, 'password_too_long'),
                                ('1q2w3e4r5t6y7u8i9o0p', 'password_too_common'), ('123456789012345', 'password_entirely_numeric')]:
            with self.subTest(code=code):
                with self.assertRaises(ValidationError) as result:
                    validate_password(candidate, self.user)
                self.assertIn(code, [error.code for error in result.exception.error_list])
        for attribute in ['username', 'first_name', 'last_name', 'email', 'display_name']:
            user = User(**{attribute: PASSWORD + '@example.com' if attribute == 'email' else PASSWORD})
            with self.subTest(attribute=attribute):
                with self.assertRaises(ValidationError) as result:
                    validate_password(PASSWORD, user)
                self.assertIn('password_too_similar', [error.code for error in result.exception.error_list])

    def test_actual_admin_creation_reset_and_own_password_change(self):
        self.client.force_login(self.dev)
        for candidate in [PASSWORD[:-1], PASSWORD]:
            response = self.post('/admin/accounts/user/add/', {
                'username': 'newmember', 'password1': candidate, 'password2': candidate,
                'usable_password': 'true', '_save': 'Save',
            }, json=False)
            self.assertEqual(response.status_code, 200 if len(candidate) == 14 else 302)
            self.assertEqual(User.objects.filter(username='newmember').exists(), len(candidate) == 15)
        for candidate in [PASSWORD[:-1], 'x' * 1025, PASSWORD]:
            response = self.post(f'/admin/accounts/user/{self.user.pk}/password/', {
                'password1': candidate, 'password2': candidate, 'usable_password': 'true',
            }, json=False)
            self.assertEqual(response.status_code, 400 if len(candidate) > 1024 else 200 if len(candidate) == 14 else 302)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))
        for old, new, expected in [('wrong', PASSWORD + 'new', 200), (PASSWORD, PASSWORD[:-1], 200), (PASSWORD, PASSWORD + 'new', 302)]:
            response = self.post('/admin/password_change/', {'old_password': old, 'new_password1': new, 'new_password2': new}, json=False)
            self.assertEqual(response.status_code, expected)
        self.dev.refresh_from_db()
        self.assertTrue(self.dev.check_password(PASSWORD + 'new'))

    def test_legacy_session_backend_is_still_supported(self):
        self.client.force_login(self.user, backend='django.contrib.auth.backends.ModelBackend')
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['id'], self.user.pk)

    def test_input_limits_precede_hash_and_csrf_form_parsing(self):
        with patch.object(ModelBackend, 'authenticate') as check:
            self.assertEqual(self.post('/api/auth/login', {'username': 'alice', 'password': 'x' * 1025}).status_code, 400)
            self.assertEqual(self.post('/admin/login/', {'username': 'alice', 'password': 'x' * 1025}, json=False).status_code, 400)
            for path, kind in [('/api/auth/login', 'application/json'), ('/api/auth/password', 'application/json'), ('/admin/login/', 'application/x-www-form-urlencoded')]:
                response = self.client.post(path, 'x' * 32769, content_type=kind)
                self.assertEqual(response.status_code, 413)
            check.assert_not_called()

    def test_escaped_unicode_passwords_fit_request_budget(self):
        # JSON represents one non-BMP code point using two escaped surrogates.
        password = '\U0001f340' * 1024
        self.user.set_password(password)
        self.user.save(update_fields=['password'])
        self.client.force_login(self.user)
        response = self.post('/api/auth/password', {'old_password': password, 'new_password': '\U0001f333' * 1024})
        self.assertEqual(response.status_code, 200)

    def test_malformed_unicode_is_rejected_without_password_hashing(self):
        with patch.object(ModelBackend, 'authenticate') as check:
            for username, password in [('alice', '\ud800'), ('\ud800', PASSWORD)]:
                self.assertEqual(self.post('/api/auth/login', {'username': username, 'password': password}).status_code, 400)
                self.assertIsNone(authenticate(username=username, password=password))
            check.assert_not_called()


@override_settings(PASSWORD_HASHERS=FAST_HASHERS)
class LoginProtectionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('alice', password=PASSWORD)
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')

    def attempt(self, username='alice', password='wrong', admin=False, address='127.0.0.1'):
        return self.client.post('/admin/login/' if admin else '/api/auth/login', {'username': username, 'password': password},
                                **({} if admin else {'content_type': 'application/json'}),
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, REMOTE_ADDR=address)

    def test_existing_missing_and_inactive_accounts_have_identical_failures(self):
        User.objects.create_user('inactive', password=PASSWORD, is_active=False)
        results = []
        with self.assertLogs('accounts.security', level='INFO') as logs:
            for username in ['alice', 'missing', 'inactive']:
                results.append([(response.status_code, response.json()) for response in [self.attempt(username) for _ in range(5)]])
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1], results[2])
        self.assertEqual([status for status, _ in results[0]], [401] * 4 + [429])
        self.assertNotIn('wrong', '\n'.join(logs.output))
        self.assertNotIn('alice', '\n'.join(logs.output))
        for row in LoginAttempt.objects.all():
            self.assertEqual(len(row.account_key), 64)
            self.assertEqual(len(row.failure_times), 5)

    def test_cooldown_does_not_extend_and_expires(self):
        for _ in range(5):
            self.attempt()
        row = LoginAttempt.objects.get()
        locked_until = row.locked_until
        with patch.object(ModelBackend, 'authenticate') as check:
            response = self.attempt(password=PASSWORD)
            self.assertEqual(response.status_code, 429)
            self.assertTrue(1 <= int(response['Retry-After']) <= 300)
            self.assertIn('no-store', response['Cache-Control'])
            check.assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.locked_until, locked_until)
        self.assertEqual(len(row.failure_times), 5)
        with patch('accounts.backends.timezone.now', return_value=locked_until + timedelta(seconds=1)):
            self.assertEqual(self.attempt(password=PASSWORD).status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.failure_times, [])
        self.assertIsNone(row.locked_until)

    def test_sliding_window_and_success_reset(self):
        start = timezone.now()
        for offset in [0, 100, 200, 300]:
            with patch('accounts.backends.timezone.now', return_value=start + timedelta(seconds=offset)):
                self.assertEqual(self.attempt().status_code, 401)
        with patch('accounts.backends.timezone.now', return_value=start + timedelta(seconds=901)):
            self.assertEqual(self.attempt().status_code, 401)
            self.assertEqual(len(LoginAttempt.objects.get().failure_times), 4)
            self.assertEqual(self.attempt(password=PASSWORD).status_code, 200)
        self.assertEqual(LoginAttempt.objects.get().failure_times, [])

    def test_api_and_admin_share_account_limit_across_ips(self):
        for admin in [False, True]:
            LoginAttempt.objects.all().delete()
            for _ in range(4):
                self.attempt(admin=admin)
            response = self.attempt(admin=not admin, password=PASSWORD, address='192.0.2.4')
            # One good login below threshold resets the counter through either entry.
            self.assertEqual(response.status_code, 200 if admin else 302)
            for _ in range(5):
                self.attempt(admin=admin)
            response = self.attempt(admin=not admin, password=PASSWORD, address='192.0.2.8')
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.json()['error']['code'], 'rate_limited')
            self.assertIn('Retry-After', response)
        self.assertEqual(self.attempt(username='another-missing', address='192.0.2.8').status_code, 401)

    def test_unicode_alias_and_whitespace_cannot_split_account_state(self):
        for username in ['alice', ' alice ', 'ａｌｉｃｅ', 'alice', 'ａｌｉｃｅ']:
            response = self.attempt(username=username)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(LoginAttempt.objects.count(), 1)

    def test_cleanup_preserves_live_state(self):
        self.attempt()
        old = LoginAttempt.objects.create(account_key=hashlib.sha256(b'old').hexdigest())
        LoginAttempt.objects.filter(pk=old.pk).update(updated_at=timezone.now() - timedelta(days=2))
        call_command('clear_login_attempts', stdout=StringIO())
        self.assertEqual(LoginAttempt.objects.count(), 1)
        self.assertEqual(len(LoginAttempt.objects.get().failure_times), 1)


@override_settings(PASSWORD_HASHERS=FAST_HASHERS)
class LoginConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.user = User.objects.create_user('alice', password=PASSWORD)

    def test_parallel_http_requests_do_not_bypass_limit_or_lose_initial_insert(self):
        # Independent connections, simultaneous first insert, varied IP/user-agent.
        for username in ['alice', 'missing']:
            with self.subTest(username=username):
                LoginAttempt.objects.all().delete()
                barrier = Barrier(10)
                def run(index):
                    connections.close_all()
                    try:
                        client = Client(enforce_csrf_checks=True)
                        client.get('/api/auth/session')
                        barrier.wait(timeout=10)
                        return client.post('/api/auth/login', {'username': username, 'password': 'wrong'},
                                           content_type='application/json', REMOTE_ADDR=f'192.0.2.{index + 1}',
                                           HTTP_USER_AGENT=f'test-{index}', HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value).status_code
                    finally:
                        connections.close_all()
                # Observe real Django password checks, without replacing authentication.
                original = ModelBackend.authenticate
                with patch.object(ModelBackend, 'authenticate', autospec=True, side_effect=original) as check:
                    with ThreadPoolExecutor(max_workers=10) as executor:
                        results = list(executor.map(run, range(10)))
                    self.assertEqual(check.call_count, 5)
                self.assertCountEqual(results, [401] * 4 + [429] * 6)
                row = LoginAttempt.objects.get()
                self.assertEqual(len(row.failure_times), 5)
                self.assertIsNotNone(row.locked_until)
                self.assertIsNone(authenticate(username=username, password=PASSWORD))

    def test_async_authentication_uses_same_protection(self):
        async def run():
            for _ in range(5):
                self.assertIsNone(await aauthenticate(username='alice', password='wrong'))
            self.assertIsNone(await aauthenticate(username='alice', password=PASSWORD))
        async_to_sync(run)()
        self.assertEqual(len(LoginAttempt.objects.get().failure_times), 5)

    def test_separate_processes_share_http_login_state(self):
        env = os.environ.copy()
        for name, field in [('PGDATABASE', 'NAME'), ('PGUSER', 'USER'), ('PGPASSWORD', 'PASSWORD'),
                            ('PGHOST', 'HOST'), ('PGPORT', 'PORT')]:
            env[name] = str(connection.settings_dict[field])
        script = '''
import django
django.setup()
from django.test import Client, override_settings
with override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'], ALLOWED_HOSTS=['testserver']):
    response = Client().post('/api/auth/login', {'username': 'alice', 'password': 'wrong'}, content_type='application/json')
    print(response.status_code)
'''
        def run(_):
            result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parent.parent,
                                    env=env, capture_output=True, text=True, check=True, timeout=15)
            return int(result.stdout.strip())
        with ThreadPoolExecutor(max_workers=6) as executor:
            self.assertCountEqual(list(executor.map(run, range(6))), [401] * 4 + [429] * 2)
        self.assertEqual(len(LoginAttempt.objects.get().failure_times), 5)
        self.assertIsNone(authenticate(username='alice', password=PASSWORD))
