import json
from unittest.mock import patch
from django.http import JsonResponse
from django.test import SimpleTestCase, RequestFactory, override_settings
from .logging import SafeJsonFormatter
from .middleware import RequestDiagnosticsMiddleware, request_id


@override_settings(CUERELAY_BUILD='test-build')
class DiagnosticTests(SimpleTestCase):
    def test_all_http_results_correlate_and_do_not_capture_inputs(self):
        identifier = 'c0ad52ea-4410-4893-aeba-cac9482cffd2'
        for status in [200, 401, 403, 409, 500]:
            request = RequestFactory().post('/api/auth/login?password=secret', {'password': 'secret'}, HTTP_X_REQUEST_ID=identifier,
                                            HTTP_AUTHORIZATION='Bearer private-token')
            middleware = RequestDiagnosticsMiddleware(lambda _: JsonResponse({}, status=status))
            with self.assertLogs('cuerelay.diagnostics', level='INFO') as logs:
                response = middleware(request)
            self.assertEqual(response['X-Request-ID'], identifier)
            self.assertEqual(response['X-CueRelay-Build'], 'test-build')
            fields = logs.records[0].msg
            self.assertEqual(fields['status'], status)
            self.assertNotIn('secret', str(fields))
            self.assertNotIn('private-token', str(fields))

    def test_invalid_request_id_cannot_inject_logs(self):
        value = request_id('Authorization=private\nforged')
        self.assertEqual(len(value), 36)
        self.assertNotIn('private', value)

    def test_exception_is_safe_and_response_generic(self):
        request = RequestFactory().get('/api/ass/empty')
        middleware = RequestDiagnosticsMiddleware(lambda _: JsonResponse({}))
        middleware(request)
        try:
            raise ValueError('password=secret /Users/private/config')
        except ValueError as error:
            with self.assertLogs('cuerelay.diagnostics', level='INFO') as logs:
                response = middleware.process_exception(request, error)
        self.assertEqual(response.status_code, 500)
        serialized = SafeJsonFormatter().format(logs.records[0])
        self.assertEqual(json.loads(serialized)['exception']['type'], 'ValueError')
        self.assertNotIn('secret', serialized + response.content.decode())
        self.assertNotIn('/Users/private', serialized)

    def test_logging_failure_does_not_break_request(self):
        with patch('diagnostics.middleware.logger.info', side_effect=OSError('disk full')):
            response = RequestDiagnosticsMiddleware(lambda _: JsonResponse({}))(RequestFactory().get('/api/ass/empty'))
        self.assertEqual(response.status_code, 200)

# Uses real adapters/CSRF/transactions, rather than only status-code stubs.
from copy import deepcopy
from django.test import TestCase, Client
from accounts.models import User
from organizations.services import create_organization
from projects.services import create_project


class DiagnosticHTTPTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('diagnostic-user')
        org = create_organization('diagnostic-org', self.user.pk)
        self.project = create_project(self.user, org.pk, name='fixture', description='',
                                      media={'sha256': 'a' * 64, 'size': 100, 'duration_ms': 4000}, source=None)
        self.path = f'/api/organizations/{org.pk}/projects/{self.project.pk}/document'
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/auth/session')

    def test_csrf_auth_success_and_conflict_have_queryable_request_ids(self):
        identifier = 'eaa62404-c7a5-445d-b963-64f9cf528143'
        document = deepcopy(self.project.document)
        document['cues'] = [{'id': 'new-diagnostic', 'text': 'subtitle', 'start_ms': 0, 'end_ms': 1000, 'style_id': document['styles'][0]['id']}]
        body = {'revision': 1, 'document': document}
        for authenticated, csrf, status in [(False, False, 403), (False, True, 401), (True, True, 200), (True, True, 409)]:
            if authenticated:
                self.client.force_login(self.user)
            headers = {'HTTP_X_REQUEST_ID': identifier}
            if csrf:
                headers['HTTP_X_CSRFTOKEN'] = self.client.cookies['csrftoken'].value
            with self.assertLogs('cuerelay.diagnostics', level='INFO') as logs:
                response = self.client.put(self.path, body, content_type='application/json', **headers)
            self.assertEqual(response.status_code, status)
            self.assertEqual(response['X-Request-ID'], identifier)
            result = next(record.msg for record in logs.records if record.msg['event'] == 'http_result')
            self.assertEqual(result['request_id'], identifier)
            self.assertEqual(result['status'], status)
            self.assertNotIn('subtitle', str(result))
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)

    @override_settings(DEBUG=True)
    def test_actual_unhandled_exception_never_exposes_stack_even_in_debug(self):
        with patch('http_api.ass_views.make_empty', side_effect=RuntimeError('password=private-secret')):
            with self.assertLogs('cuerelay.diagnostics', level='INFO') as logs:
                response = self.client.get('/api/ass/empty')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('private-secret', response.content.decode())
        self.assertTrue(any(record.msg['event'] == 'http_exception' for record in logs.records))
