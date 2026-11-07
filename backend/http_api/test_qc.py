from django.test import Client, SimpleTestCase, override_settings
from ass_format import empty_document


class QcContractTests(SimpleTestCase):
    def test_inspection_is_stateless_csrf_independent_and_returns_row_ids(self):
        client = Client(enforce_csrf_checks=True)
        document = empty_document()
        self.assertEqual(client.post('/api/ass/inspect', {'document': document}, content_type='application/json').json(), {'issues': []})
        document['cues'] = [{'id': 'new-one', 'start_ms': 0, 'end_ms': 1000,
                             'text': r'{\pos(1,2)}错误', 'style_id': document['styles'][0]['id']}]
        response = client.post('/api/ass/inspect', {'document': document}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['issues'][0]['cue_id'], 'new-one')
        self.assertEqual(response.json()['issues'][0]['type'], 'unsupported-ass')
        self.assertEqual(client.post('/api/ass/export', {'document': document}, content_type='application/json').status_code, 422)

    def test_request_contract_and_invalid_document(self):
        for payload in [{}, [], {'document': {}, 'project_id': 1}]:
            self.assertEqual(self.client.post('/api/ass/inspect', payload, content_type='application/json').status_code, 400)
        response = self.client.post('/api/ass/inspect', {'document': None}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['issues'])
        self.assertEqual(self.client.get('/api/ass/inspect').status_code, 405)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=64)
    def test_oversized_request_is_rejected_before_parsing(self):
        self.assertEqual(self.client.post('/api/ass/inspect', {'document': {'source': 'a' * 100}}, content_type='application/json').status_code, 413)
