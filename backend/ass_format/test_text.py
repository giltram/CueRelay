"""Public body tokens must retain text exactly and never expose partial input."""
import unittest

from copy import deepcopy
from pathlib import Path
from . import (AssError, text_tokens, parse_ass, serialize_ass, inspect_document,
               apply_style_operation, style_usage, copy_lines, paste_lines, split_document)


class TextTokenTests(unittest.TestCase):
    def test_static_parameters_preserve_order_and_raw_spelling(self):
        self.assertEqual(text_tokens(r'{\an7\pos(-10.5, +20)\c&HfF&\1c\alpha&H8\2a&HFF&\r\b0}字'), [
            ('an', '7'), ('pos', '(-10.5, +20)'), ('c', '&HfF&'), ('1c', ''),
            ('alpha', '&H8'), ('2a', '&HFF&'), ('r', ''), ('b', '0'), ('text', '字'),
        ])
        for tag in ('c', '1c', '2c', '3c', '4c', 'alpha', '1a', '2a', '3a', '4a'):
            for parameter in ('', '&H00&', '&Hff&'):
                self.assertEqual(text_tokens('{\\' + tag + parameter + '}'), [(tag, parameter)])
        for position in ('(-32768,32768)', '(+.5, -0.5)', '( 0,\t10 )'):
            self.assertEqual(text_tokens('{\\pos' + position + '}'), [('pos', position)])

    def test_bad_parameters_and_unknown_tags_are_located_in_dialogue_and_comment(self):
        header = Path(__file__).with_name('fixtures').joinpath('basic.ass').read_text().split('Dialogue:', 1)[0]
        for raw in (r'\c&H1234567&', r'\c&H&', r'\c&hFF&', r'\c&HFF', r'\c123', r'\alpha&H100&',
                    r'\alphaFF', r'\1a&Hfg&', r'\an0', r'\an10', r'\an', r'\rDefault',
                    r'\pos(1)', r'\pos(1,2,3)', r'\pos(32768.00001,0)', r'\pos(1e2,0)',
                    r'\pos(NaN,0)', r'\pos(１,2)', r'\pos(1_0,2)', r'\pos(1,2)junk',
                    r'\fnArial', r'\fs20', r'\bord2', r'\shad0', r'\move(1,2,3,4)', r'\t(\c&HFF&)',
                    r'\k20', r'\p1', r'\blur2', r'\r ', '\\c&HFF&\\', r'\an7\r\an7',
                    r'\pos(1,2)\r\pos(1,2)'):
            for kind in ('Dialogue', 'Comment'):
                source = header + f'{kind}: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{{{raw}}}字\n'
                with self.subTest(raw=raw, kind=kind), self.assertRaises(AssError) as error:
                    parse_ass(source)
                self.assertEqual(error.exception.issue['line'], len(header.splitlines()) + 1)

    def test_edit_inspect_styles_clipboard_and_split_keep_existing_contracts(self):
        source = Path(__file__).with_name('fixtures').joinpath('compatibility/static-overrides.ass').read_text()
        document = parse_ass(source)
        original = deepcopy(document)
        self.assertEqual(inspect_document(document), [])
        renamed = apply_style_operation(document, {'type': 'update', 'id': document['styles'][0]['id'],
                                                  'name': 'Renamed', 'fields': {'Bold': '-1'}})
        self.assertEqual(renamed['cues'], document['cues'])
        self.assertIn('Renamed', serialize_ass(renamed))
        self.assertGreater(style_usage(renamed)[renamed['styles'][0]['id']]['cues'], 0)
        with self.assertRaises(AssError):
            apply_style_operation(renamed, {'type': 'delete', 'ids': [renamed['styles'][0]['id']]})
        cue = document['cues'][0]
        copied = copy_lines(document, [cue['id']])
        pasted = paste_lines(document, copied, cue['id'], [cue['id']])['document']
        self.assertEqual(sum(line['text'] == cue['text'] for line in pasted['cues']), 2)
        with self.assertRaises(AssError):
            split_document(document, cue['id'], 'text', 1)
        added = apply_style_operation(document, {'type': 'create', 'name': 'Unused',
                                                'fields': document['styles'][0]['fields']})
        deleted = apply_style_operation(added, {'type': 'delete', 'ids': [added['styles'][-1]['id']]})
        self.assertEqual(deleted, document)
        self.assertEqual(document, original)
        document['cues'][0]['text'] += r'{\pos(1,2)}'
        self.assertEqual(inspect_document(document)[0]['cue_id'], cue['id'])
        self.assertEqual(original['source'], source)

    def test_preserves_unicode_spans_escapes_and_ordered_format_changes(self):
        self.assertEqual(text_tokens(r' 甲😀{\b1\i0}乙, <b>{\s1}\N\n\h尾 '), [
            ('text', ' 甲😀'), ('b', '1'), ('i', '0'), ('text', '乙, <b>'),
            ('s', '1'), ('N', ''), ('n', ''), ('h', ''), ('text', '尾 '),
        ])
        self.assertEqual(text_tokens(''), [])

    def test_whole_body_must_be_valid_before_tokens_are_returned(self):
        for suffix in ('{', '}', r'{\b1\unknown}', r'\x', '\n', '\u2028'):
            with self.subTest(suffix=suffix), self.assertRaises(AssError) as error:
                text_tokens('可见{\\b1}有效前缀' + suffix, line=42)
            self.assertEqual(error.exception.issue['line'], 42)
        for value in (None, 123, 'a' * 16385):
            with self.subTest(value_type=type(value)), self.assertRaises(AssError):
                text_tokens(value)
