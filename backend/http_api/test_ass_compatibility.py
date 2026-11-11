"""Real JSON conversion boundary against the authored ASS corpus."""
from django.test import SimpleTestCase
from ass_format.test_compatibility import CORPUS, corpus_manifest, assert_document, assert_output


class AssCompatibilityContractTests(SimpleTestCase):
    def test_import_export_import_corpus_matches_authored_semantics(self):
        for filename, expected in corpus_manifest()['valid'].items():
            with self.subTest(filename=filename):
                source = (CORPUS / filename).read_text(encoding='utf-8')
                imported = self.client.post('/api/ass/import', {'source': source}, content_type='application/json')
                self.assertEqual(imported.status_code, 200)
                document = imported.json()['document']
                assert_document(self, document, expected)
                exported = self.client.post('/api/ass/export', {'document': document}, content_type='application/json')
                self.assertEqual(exported.status_code, 200)
                output = exported.content.decode('utf-8')
                assert_output(self, output, expected)
                reimported = self.client.post('/api/ass/import', {'source': output}, content_type='application/json')
                self.assertEqual(reimported.status_code, 200)
                assert_document(self, reimported.json()['document'], expected)

    def test_invalid_corpus_returns_422_with_location_and_no_document(self):
        for filename, expected in corpus_manifest()['invalid'].items():
            with self.subTest(filename=filename):
                response = self.client.post('/api/ass/import', {'source': (CORPUS / filename).read_text(encoding='utf-8')}, content_type='application/json')
                self.assertEqual(response.status_code, 422)
                body = response.json()
                self.assertNotIn('document', body)
                self.assertEqual(body['issues'][0]['line'], expected['line'])
                self.assertIn(expected['message'], body['issues'][0]['message'])

    def test_unexportable_size_is_rejected_before_http_import_succeeds(self):
        from ass_format import empty_document
        source = empty_document()['source']
        source += ';' + 'x' * (1024 * 1024 - len(source.encode()) - 1)
        response = self.client.post('/api/ass/import', {'source': source}, content_type='application/json')
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('document', response.json())
        self.assertIn('1MiB', response.json()['issues'][0]['message'])
