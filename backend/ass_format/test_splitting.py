from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from uuid import UUID
from ass_format import AssError, empty_document, parse_ass, serialize_ass, split_document


def document_with(text='', start=10000, end=16000):
    doc = empty_document()
    doc['cues'] = [{'id': 'new-original', 'start_ms': start, 'end_ms': end, 'text': text, 'style': 'Default'}]
    return doc


class SplitTests(TestCase):
    def test_playhead_split_replaces_identity_and_changes_no_other_cues(self):
        doc = document_with()
        doc['cues'].append({**doc['cues'][0], 'id': 'new-next', 'start_ms': 16000, 'end_ms': 18000, 'text': '保留'})
        before = deepcopy(doc)
        result = split_document(doc, 'new-original', 'playhead', 13000)
        first, second, unchanged = result['document']['cues']
        self.assertEqual([(c['start_ms'], c['end_ms']) for c in [first, second]], [(10000, 13000), (13000, 16000)])
        self.assertEqual(first['text'] + second['text'], '')
        self.assertEqual(unchanged, before['cues'][1])
        for cue in [first, second]:
            self.assertEqual(UUID(cue['id'][4:]).version, 4)
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual((result['first_id'], result['second_id']), (first['id'], second['id']))
        self.assertEqual(doc, before)

    def test_text_proportion_rounds_to_existing_precision_and_keeps_all_characters(self):
        doc = document_with('今天下午我们一起去吧')
        result = split_document(doc, 'new-original', 'text', 4)['document']['cues']
        self.assertEqual([c['text'] for c in result], ['今天下午', '我们一起去吧'])
        self.assertEqual([(c['start_ms'], c['end_ms']) for c in result], [(10000, 12400), (12400, 16000)])
        doc = document_with('a bc', 0, 50)
        result = split_document(doc, 'new-original', 'text', 1)['document']['cues']
        self.assertEqual([c['text'] for c in result], ['a', ' bc'])
        self.assertEqual(result[0]['end_ms'], 10)
        self.assertEqual(result[0]['end_ms'], result[1]['start_ms'])

    def test_utf16_cursor_after_non_bmp_character(self):
        doc = document_with('今天😀下午')
        cues = split_document(doc, 'new-original', 'text', 4)['document']['cues']
        self.assertEqual([c['text'] for c in cues], ['今天😀', '下午'])
        self.assertEqual(cues[0]['end_ms'], 13600)  # Unicode characters, not UTF-16 units.
        with self.assertRaises(AssError):
            split_document(doc, 'new-original', 'text', 3)

    def test_source_metadata_survives_split_export_repeated_split_and_edits(self):
        source = Path(__file__).with_name('fixtures').joinpath('basic.ass').read_text()
        doc = parse_ass(source)
        original = doc['cues'][1]
        original['text'] = '甲乙丙丁'
        result = split_document(doc, original['id'], 'text', 2)
        first, second = result['document']['cues'][1:]
        self.assertEqual(first['source_id'], original['id'])
        self.assertEqual(second['source_id'], original['id'])
        again = split_document(result['document'], second['id'], 'text', 1)['document']
        output = serialize_ass(again)
        self.assertEqual(output.count('Emphasis,,0010,0020,0030,,'), 3)
        self.assertIn('Comment: 0,0:00:02.00', output)
        self.assertIn('; Keep this anchor', output)
        self.assertEqual(len(parse_ass(output)['cues']), 4)
        self.assertEqual(again['source'], doc['source'])

    def test_all_rejections_leave_input_untouched(self):
        cases = [('playhead', p, '') for p in [9990, 10000, 16000, 16010, 13001, True, None, '13000']]
        cases += [('playhead', 13000, t) for t in ['文本', ' ', r'\N']]
        cases += [('text', p, t) for p, t in [(0, '文本'), (2, '文本'), (-1, '文本'), (99, '文本'),
            (1, ' 文本'), (2, '文本 '), (1, r'甲\N乙'), (1, r'{\b1}甲乙'), (1, ''), (True, '甲乙'),
            (1, 'a\u0301b'), (2, '👩\u200d💻乙'), (4, '👩\u200d💻乙')]]
        for mode, position, text in cases:
            with self.subTest(mode=mode, position=position, text=text):
                doc = document_with(text)
                before = deepcopy(doc)
                with self.assertRaises(AssError):
                    split_document(doc, 'new-original', mode, position)
                self.assertEqual(doc, before)
        for text, position in [('甲乙', 1), ('甲乙丙丁丁', 1)]:
            with self.assertRaises(AssError):
                split_document(document_with(text, 0, 10), 'new-original', 'text', position)
        with self.assertRaises(AssError):
            split_document(document_with('甲乙丙丁丁', 0, 20), 'new-original', 'text', 1)
        with self.assertRaises(AssError):
            split_document(document_with(), 'deleted', 'playhead', 13000)
        with self.assertRaises(AssError):
            split_document(document_with(), 'new-original', 'unknown', 13000)

    def test_metadata_anchor_cannot_reference_missing_or_non_source_rows(self):
        for anchor in ['new-original', 'source-999999', None, []]:
            doc = document_with()
            doc['cues'][0]['source_id'] = anchor
            with self.assertRaises(AssError):
                serialize_ass(doc)

    def test_split_respects_event_and_byte_limits_without_partial_result(self):
        doc = document_with()
        doc['cues'] = [{**doc['cues'][0], 'id': f'new-{index}'} for index in range(5000)]
        before = deepcopy(doc)
        with self.assertRaises(AssError):
            split_document(doc, 'new-0', 'playhead', 13000)
        self.assertEqual(doc, before)
        doc = document_with()
        remaining = 1024 * 1024 - len(serialize_ass(doc).encode('utf-8')) - 20
        doc['source'] = doc['source'].replace('Title: CueRelay', 'Title: CueRelay' + 'x' * remaining)
        serialize_ass(doc)  # Existing snapshot itself is valid and below the limit.
        before = deepcopy(doc)
        with self.assertRaises(AssError):
            split_document(doc, 'new-original', 'playhead', 13000)
        self.assertEqual(doc, before)
