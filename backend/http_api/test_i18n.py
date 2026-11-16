from django.test import TestCase
from accounts.models import User
from ass_format import AssError, validate_fields, empty_document
from message_contracts import localized


class MessageMetadataTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('language-http', password='test-only-long-password-927!')
        self.client.force_login(self.user)

    def test_settings_wire_contract_and_identity_guard(self):
        response = self.client.patch('/api/me/settings', {'language_preference': 'en'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['language_preference'], 'en')
        response = self.client.patch('/api/me/settings', {'language_preference': 'zh-CN'}, content_type='application/json', HTTP_X_CUERELAY_USER=str(self.user.pk + 1))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.get('/api/me/settings').json()['language_preference'], 'en')

    def test_broad_invalid_request_keeps_specific_password_and_settings_reasons(self):
        response = self.client.post('/api/auth/password', {'old_password': 'wrong', 'new_password': 'different-test-long-password-942!', 'new_password_confirmation': 'different-test-long-password-942!'}, content_type='application/json')
        value = response.json()['error']
        self.assertEqual(value['code'], 'invalid_request')
        self.assertEqual(value['message'], '旧密码不正确。')
        self.assertEqual(value['details'][0]['reason'], 'server.theCurrentPasswordIsIncorrect')
        response = self.client.patch('/api/me/settings', {'language_preference': 'unknown'}, content_type='application/json')
        other = response.json()['error']
        self.assertEqual(other['code'], value['code'])
        self.assertNotEqual(other['details'][0]['reason'], value['details'][0]['reason'])

    def test_format_error_preserves_protocol_and_adds_reason_params(self):
        document = empty_document()
        document['styles'][0]['fields']['Fontsize'] = 'Infinity'
        response = self.client.post('/api/ass/export', {'document': document}, content_type='application/json')
        issue = response.json()['issues'][0]
        self.assertEqual(response.status_code, 422)
        self.assertEqual(issue['code'], 'unsupported_or_invalid_ass')
        self.assertIn('reason', issue)
        self.assertEqual(issue['params']['v0'], 'Fontsize')
        self.assertIn('Fontsize', issue['message'])
