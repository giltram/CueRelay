from django.test import SimpleTestCase, Client
from ass_format import empty_document


class ClipboardContractTests(SimpleTestCase):
    def test_stateless_roundtrip_and_invalid_contract(self):
        client = Client(enforce_csrf_checks=True)
        document = empty_document()
        pasted = client.post('/api/ass/clipboard', {'document': document, 'text': '你好\nworld',
                                                  'active_id': None, 'ids': [], 'fields': None}, content_type='application/json')
        self.assertEqual(pasted.status_code, 200)
        result = pasted.json()
        # Exercise the real project template/style invariant without a database.
        from types import SimpleNamespace
        from projects.services import validate_document_base
        validate_document_base(SimpleNamespace(document=document), result['document'])
        copied = client.post('/api/ass/clipboard', {'document': result['document'], 'ids': result['selected_ids']}, content_type='application/json')
        self.assertEqual(copied.status_code, 200)
        self.assertIn('Dialogue:', copied.json()['text'])
        self.assertEqual(client.post('/api/ass/clipboard', {}, content_type='application/json').status_code, 400)
        self.assertEqual(client.post('/api/ass/clipboard', {'document': document, 'ids': ['missing']}, content_type='application/json').status_code, 422)
        self.assertEqual(client.get('/api/ass/clipboard').status_code, 405)
