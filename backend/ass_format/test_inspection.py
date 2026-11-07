from copy import deepcopy
import unittest
from . import AssError, empty_document, inspect_document, parse_ass, serialize_ass


class InspectionTests(unittest.TestCase):
    def document(self, **patch):
        document = empty_document()
        document['cues'] = [{'id': 'new-one', 'start_ms': 1000, 'end_ms': 3000,
                             'text': '正常字幕', 'style_id': document['styles'][0]['id'], **patch}]
        return document

    def test_valid_empty_and_supported_documents_are_unchanged_and_exportable(self):
        for document in [empty_document(), self.document(text=r'{\b1\i1}中文{\b0}\NEnglish\htext')]:
            before = deepcopy(document)
            self.assertEqual(inspect_document(document), [])
            self.assertEqual(document, before)
            parse_ass(serialize_ass(document))

    def test_collects_export_failures_for_every_row_and_maps_ids(self):
        document = self.document(text=r'{\pos(1,2)}不支持')
        document['cues'].append({**document['cues'][0], 'id': 'new-two', 'text': '可以', 'end_ms': 0})
        issues = inspect_document(document)
        self.assertEqual([(i['cue_id'], i['type']) for i in issues], [('new-one', 'unsupported-ass'), ('new-two', 'invalid-time')])
        with self.assertRaises(AssError):
            serialize_ass(document)

    def test_missing_styles_and_all_known_text_restrictions_reuse_export_rules(self):
        self.assertEqual(inspect_document(self.document(style_id='missing'))[0]['type'], 'missing-style')
        for text in [r'{\k20}唱词', '{', '}', 'literal\nnewline', '\\x', '\\', 'a' * 16385]:
            with self.subTest(text=text[:20]):
                document = self.document(text=text)
                self.assertEqual(inspect_document(document)[0]['type'], 'unsupported-ass')
                with self.assertRaises(AssError) as error:
                    serialize_ass(document)
                self.assertEqual(inspect_document(document)[0]['message'], str(error.exception))

    def test_malformed_schema_metadata_and_source_are_document_or_row_errors(self):
        for document in [None, {}, {**empty_document(), 'schema_version': 1}, {**empty_document(), 'source': '[Fonts]\n'}]:
            self.assertTrue(inspect_document(document))
        document = self.document(ass_fields={})
        self.assertEqual(inspect_document(document)[0]['cue_id'], 'new-one')
        document = self.document()
        document['cues'].append(deepcopy(document['cues'][0]))
        self.assertIn('ID', inspect_document(document)[0]['message'])

    def test_complete_output_limits_are_still_checked(self):
        document = self.document(text='a' * 16384)
        document['cues'] = [{**document['cues'][0], 'id': f'new-{index}'} for index in range(65)]
        self.assertTrue(inspect_document(document))
        with self.assertRaises(AssError):
            serialize_ass(document)

    def test_large_project_and_edit_recheck(self):
        document = self.document(text='')
        self.assertEqual(inspect_document(document), [])  # Empty axes are valid ASS.
        document['cues'][0]['text'] = r'{\bad}错误'
        self.assertTrue(inspect_document(document))
        document['cues'][0]['text'] = '修复'
        document['cues'] = [{**document['cues'][0], 'id': f'new-{index}', 'start_ms': index * 2000,
                             'end_ms': index * 2000 + 1000} for index in range(5000)]
        self.assertEqual(inspect_document(document), [])
