from copy import deepcopy
from pathlib import Path
import unittest
from ass_format import AssError, empty_document, parse_ass, serialize_ass, copy_lines, paste_lines


class ClipboardTests(unittest.TestCase):
    def setUp(self):
        self.document = parse_ass((Path(__file__).with_name('fixtures') / 'basic.ass').read_text())
        self.ids = [cue['id'] for cue in self.document['cues']]

    def test_copy_paste_preserves_hidden_metadata_commas_and_order(self):
        text = copy_lines(self.document, self.ids)
        self.assertIn('译者,0000,0000,0000,,', text)
        self.assertIn('第二行, with comma', text)
        original = deepcopy(self.document)
        result = paste_lines(self.document, text, self.ids[1], [self.ids[1]])
        self.assertEqual(self.document, original)
        self.assertIs(result['document']['source'], self.document['source'])
        self.assertEqual(result['document']['styles'], original['styles'])
        self.assertEqual([c['text'] for c in result['document']['cues']],
                         [original['cues'][0]['text'], *[c['text'] for c in original['cues']], original['cues'][1]['text']])
        self.assertEqual(len(set(c['id'] for c in result['document']['cues'])), 4)
        output = serialize_ass(result['document'])
        self.assertEqual(output.count('译者,0000,0000,0000,,'), 2)
        self.assertIn('Comment:', output)
        self.assertEqual([c['text'] for c in parse_ass(output)['cues']], [c['text'] for c in result['document']['cues']])

    def test_canonical_clipboard_handles_reordered_source_format(self):
        source = self.document['source'].replace('Layer, Start, End', 'Start, Layer, End')
        source = source.replace('Dialogue: 0,0:00:01.20,', 'Dialogue: 0:00:01.20,0,')
        source = source.replace('Dialogue: 1,0:00:02.50,', 'Dialogue: 0:00:02.50,1,')
        source = source.replace('Comment: 0,0:00:02.00,', 'Comment: 0:00:02.00,0,')
        document = parse_ass(source)
        ids = [c['id'] for c in document['cues']]
        text = copy_lines(document, ids)
        self.assertTrue(text.startswith('Dialogue: 0,0:00:01.20,'))
        result = paste_lines(document, text, ids[0], [ids[0]])
        self.assertEqual(result['document']['cues'][0]['start_ms'], 1200)
        serialize_ass(result['document'])

    def test_single_over_runs_downwards_multi_over_only_touches_selection(self):
        doc = self.document
        doc['cues'].append({**doc['cues'][0], 'id': 'new-third', 'text': 'third'})
        result = paste_lines(doc, 'one\ntwo\nthree', self.ids[0], [self.ids[0]], ['text'])['document']
        self.assertEqual([c['text'] for c in result['cues']], ['one', 'two', 'three'])
        result = paste_lines(doc, 'one\ntwo\nextra', self.ids[0], [self.ids[0], 'new-third'], ['text'])['document']
        self.assertEqual([c['text'] for c in result['cues']], ['one', doc['cues'][1]['text'], 'two'])
        for before, after in zip(doc['cues'], result['cues']):
            self.assertEqual({k: v for k, v in before.items() if k != 'text'}, {k: v for k, v in after.items() if k != 'text'})
        self.assertIs(result['source'], doc['source'])

    def test_over_fields_validate_complete_intervals_and_leave_input_untouched(self):
        text = 'Dialogue: 0,0:00:09.00,0:00:10.00,Unknown,,0000,0000,0000,,new text'
        original = deepcopy(self.document)
        with self.assertRaises(AssError):
            paste_lines(self.document, text, self.ids[0], [self.ids[0]], ['start_ms'])
        self.assertEqual(self.document, original)
        result = paste_lines(self.document, text, self.ids[0], [self.ids[0]], ['start_ms', 'end_ms', 'style_id'])['document']
        self.assertEqual(result['cues'][0]['start_ms'], 9000)
        self.assertEqual(result['cues'][0]['style_id'], self.document['cues'][0]['style_id'])
        self.assertEqual(result['cues'][0]['text'], self.document['cues'][0]['text'])

    def test_plain_text_and_empty_document_paste(self):
        doc = empty_document()
        result = paste_lines(doc, '  first  \r\n\nsecond', None, [])['document']
        self.assertEqual([c['text'] for c in result['cues']], ['  first  ', 'second'])
        self.assertTrue(all(c['start_ms'] == 0 and c['end_ms'] == 3000 for c in result['cues']))
        self.assertEqual(doc['cues'], [])

    def test_clipboard_metadata_is_bounded_validated_and_cannot_modify_original_anchors(self):
        pasted = paste_lines(self.document, 'plain', self.ids[0], [self.ids[0]])['document']
        self.assertIs(pasted['source'], self.document['source'])
        for field, value in [('Layer', '-1'), ('Layer', '100000'), ('Name', 'bad,name'),
                             ('Name', 'bad\nname'), ('MarginV', None)]:
            invalid = deepcopy(pasted)
            invalid['cues'][0]['ass_fields'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(AssError):
                serialize_ass(invalid)
        invalid = deepcopy(self.document)
        invalid['cues'][0]['ass_fields'] = pasted['cues'][0]['ass_fields']
        with self.assertRaises(AssError):
            serialize_ass(invalid)

    def test_invalid_clipboard_and_selection_rejected(self):
        for text in ['', 'Dialogue: incomplete', '[Events]', 'Dialogue: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,,bad', r'{\k20}unsupported']:
            with self.subTest(text=text), self.assertRaises(AssError):
                paste_lines(self.document, text, self.ids[0], [self.ids[0]])
        for ids in [[], [self.ids[0], self.ids[0]], ['missing'], [None], 'not-list']:
            with self.subTest(ids=ids), self.assertRaises(AssError):
                copy_lines(self.document, ids)
        for fields in [[], ['Layer'], ['text', 'text'], [None]]:
            with self.subTest(fields=fields), self.assertRaises(AssError):
                paste_lines(self.document, 'valid', self.ids[0], [self.ids[0]], fields)
