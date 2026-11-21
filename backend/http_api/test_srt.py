"""Anonymous conversions cannot access the database or accept media/project data."""
from copy import deepcopy
from django.test import SimpleTestCase, override_settings
from ass_format import parse_ass, serialize_ass
from srt_format import parse_srt


class SrtHttpTests(SimpleTestCase):
    def test_import_edit_export_and_ass_compatibility_without_session(self):
        response = self.client.post('/api/srt/import', {'source': '\ufeff3\r\n00:00:01,234 --> 00:00:02,345\r\n<b>中文 😀</b>\r\n下一行'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        document = response.json()['document']
        document['cues'][0]['text'] += ' 已编辑'
        before = deepcopy(document)
        response = self.client.post('/api/srt/export', {'document': document}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/plain; charset=utf-8')
        self.assertIn('cuerelay.srt', response['Content-Disposition'])
        self.assertEqual(response.content.decode(), '1\n00:00:01,230 --> 00:00:02,350\n<b>中文 😀</b>\n下一行 已编辑\n\n')
        self.assertEqual(document, before)
        response = self.client.post('/api/ass/export', {'document': document}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(parse_ass(response.content.decode())['cues'][0]['text'], document['cues'][0]['text'])

    def test_invalid_block_returns_localized_line_and_block_with_no_document(self):
        response = self.client.post('/api/srt/import', {'source': '1\n00:00:01,000 --> 00:00:02,000\n好\n\n2\nwrong\n坏'}, content_type='application/json')
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('document', response.json())
        issue = response.json()['issues'][0]
        self.assertEqual((issue['line'], issue['block']), (6, 2))
        self.assertEqual(issue['reason'], 'srt.invalidTiming')
        self.assertEqual(issue['params'], {'block': 2})

    def test_schema_rejects_files_media_project_writes_and_invalid_values(self):
        for url, valid in [('/api/srt/import', {'source': ''}), ('/api/srt/export', {'document': parse_srt('')})]:
            for extra in ('video', 'audio', 'project_id', 'revision'):
                with self.subTest(url=url, extra=extra):
                    response = self.client.post(url, {**valid, extra: 'no'}, content_type='application/json')
                    self.assertEqual(response.status_code, 400)
            self.assertEqual(self.client.get(url).status_code, 405)
            self.assertEqual(self.client.post(url, [valid], content_type='application/json').status_code, 400)
        for source in (None, {}, 3, '\ud800'):
            self.assertEqual(self.client.post('/api/srt/import', {'source': source}, content_type='application/json').status_code, 422)
        for document in (None, {}, {'source': ''}):
            self.assertEqual(self.client.post('/api/srt/export', {'document': document}, content_type='application/json').status_code, 422)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=128)
    def test_json_request_budget(self):
        for url, data in [('/api/srt/import', {'source': 'x' * 200}), ('/api/srt/export', {'document': {'source': 'x' * 200}})]:
            self.assertEqual(self.client.post(url, data, content_type='application/json').status_code, 413)

    def test_escaping_unsupported_tags_and_export_failures_are_atomic(self):
        for text in ('<img src=x>', r'{\b1}injection', r'\N', '&#92;N'):
            response = self.client.post('/api/srt/import', {'source': f'1\n00:00:00,000 --> 00:00:01,000\n{text}'}, content_type='application/json')
            self.assertEqual(response.status_code, 422)
            self.assertNotIn('document', response.json())
        document = parse_srt('')
        document['cues'] = [{'id': 'new-1', 'style_id': document['styles'][0]['id'], 'start_ms': 0, 'end_ms': 10, 'text': r'a\N\Nb'}]
        before = deepcopy(document)
        response = self.client.post('/api/srt/export', {'document': document}, content_type='application/json')
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('Content-Disposition', response)
        self.assertEqual(document, before)
        self.assertIn(r'a\N\Nb', serialize_ass(document))
