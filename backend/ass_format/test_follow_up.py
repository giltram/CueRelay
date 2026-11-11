"""R1–R3: validate raw lexemes before normalization can erase evidence."""
from copy import deepcopy
import unittest
from uuid import uuid4

from ass_format import AssError, apply_style_operation, import_style, parse_ass, serialize_ass
from ass_format.styles import STYLE_FIELDS
from ass_format.test_compatibility import basic


class RawLexemeRegressionTests(unittest.TestCase):
    def test_r1_structured_keys_and_values_reject_unicode_boundary_whitespace(self):
        for key, value in [('PlayResX', '640'), ('PlayResY', '360'), ('ScaledBorderAndShadow', 'yes')]:
            for space in ('\u00a0', '\u2003', '\u3000'):
                for record in (f'{space}{key}: {value}', f' {space}{key}: {value}',
                               f'{key}{space}: {value}', f'{key}: {space}{value}', f'{key}: {value}{space}'):
                    with self.subTest(record=record):
                        source = basic().replace(f'{key}: {value}', record)
                        with self.assertRaises(AssError) as caught:
                            parse_ass(source)
                        self.assertEqual(caught.exception.issue['line'], next(
                            i for i, line in enumerate(source.splitlines(), 1) if line == record))

    def test_r2_style_fields_reject_unicode_boundary_whitespace_before_normalizing(self):
        # Check every declared style field, including reordered formats where
        # the first field is not Name. Do not confuse syntax with subtitle text.
        for order in (STYLE_FIELDS, [*reversed(STYLE_FIELDS)]):
            for field in STYLE_FIELDS:
                for space in ('\u00a0', '\u2003', '\u3000'):
                    for side in ('leading', 'trailing'):
                        lines = basic().splitlines()
                        lines[11] = 'Format: ' + ', '.join(order)
                        for index in (12, 13):
                            values = dict(zip(STYLE_FIELDS, lines[index].removeprefix('Style: ').split(',')))
                            if index == 12:
                                values[field] = space + values[field] if side == 'leading' else values[field] + space
                            lines[index] = 'Style: ' + ','.join(values[name] for name in order)
                        with self.subTest(field=field, space=space, side=side, reordered=order != STYLE_FIELDS):
                            with self.assertRaises(AssError) as caught:
                                parse_ass('\n'.join(lines))
                            self.assertEqual(caught.exception.issue['line'], 13)
                            self.assertIn(field, caught.exception.issue['message'])

    def test_r2_definition_name_and_font_tail_whitespace_rejected(self):
        for field, original in [('Name', 'Emphasis'), ('Fontname', 'Local Test Font')]:
            for suffix in (' ', '\t', ' \t'):
                lines = basic().splitlines()
                values = dict(zip(STYLE_FIELDS, lines[13].removeprefix('Style: ').split(',')))
                values[field] = original + suffix
                lines[13] = 'Style: ' + ','.join(values[name] for name in STYLE_FIELDS)
                with self.subTest(field=field, suffix=suffix):
                    with self.assertRaises(AssError) as caught:
                        parse_ass('\n'.join(lines))
                    self.assertEqual(caught.exception.issue['line'], 14)

    def test_safe_ascii_whitespace_still_normalizes_to_expected_values(self):
        source = basic()
        lines = []
        for line in source.splitlines():
            if line.startswith(('PlayResX:', 'PlayResY:', 'ScaledBorderAndShadow:')):
                key, value = line.split(':', 1)
                line = ' \t' + key + ': \t' + value.strip() + ' \t'
            elif line.startswith('Style: '):
                values = line.removeprefix('Style: ').split(',')
                values = [' \t' + value if field in ('Name', 'Fontname') else ' \t' + value + ' \t'
                          for field, value in zip(STYLE_FIELDS, values)]
                line = ' \tStyle: ' + ','.join(values)
            lines.append(line)
        document = parse_ass('\n'.join(lines))
        expected = parse_ass(source)
        self.assertEqual(document['script'], expected['script'])
        self.assertEqual([(s['name'], s['fields']) for s in document['styles']], [(s['name'], s['fields']) for s in expected['styles']])
        output = serialize_ass(document)
        self.assertIn('Style: Emphasis,Local Test Font,30,', output)
        self.assertIn('PlayResX: 640', output)

    def test_unicode_spaces_in_text_and_opaque_metadata_are_preserved(self):
        source = basic().replace('中文基础验证', '\u00a0中文\u3000标题\u00a0').replace(
            '保留注释', '\u00a0保留\u2003注释\u00a0').replace('你好，世界', '\u00a0你好\u3000世界\u00a0')
        document = parse_ass(source)
        self.assertTrue(document['cues'][0]['text'].startswith('\u00a0你好\u3000世界\u00a0'))
        output = serialize_ass(document)
        for value in ('Title: \u00a0中文\u3000标题\u00a0', '\u00a0保留\u2003注释\u00a0', '\u00a0你好\u3000世界\u00a0'):
            self.assertIn(value, output)

    def test_other_syntax_tokens_do_not_inherit_unicode_stripping(self):
        for old, new in (
            ('[Events]', '\u00a0[Events]'),
            ('ScriptType: v4.00+', 'ScriptType: \u00a0v4.00+'),
            ('Layer, Start, End, Style', 'Layer, \u00a0Start, End, Style'),
            ('0:00:01.20', '\u00a00:00:01.20'),
            ('Dialogue: 0,', 'Dialogue: \u00a00,'),
            ('0000,,保留注释', '0000,\u00a0,保留注释'),
        ):
            with self.subTest(token=new), self.assertRaises(AssError):
                parse_ass(basic().replace(old, new))


class ReservedDefaultRegressionTests(unittest.TestCase):
    def test_r3_default_case_alias_definitions_rejected_at_original_line(self):
        for name in ('default', 'DEFAULT', 'DeFaUlT'):
            for source in (basic().replace('Emphasis', name), basic().replace('Default', name)):
                with self.subTest(name=name, source=source):
                    with self.assertRaises(AssError) as caught:
                        parse_ass(source)
                    self.assertIn(caught.exception.issue['line'], (13, 14))
                    self.assertIn('Default', caught.exception.issue['message'])

    def test_r3_names_rejected_by_create_update_copy_template_and_direct_export(self):
        document = parse_ass(basic())
        original = deepcopy(document)
        style = document['styles'][1]
        template = {'id': str(uuid4()), 'revision': 1, 'fields': style['fields'], 'reference': document['script']}
        for name in ('default', 'DEFAULT', 'DeFaUlT'):
            for operation in (
                {'type': 'create', 'name': name, 'fields': style['fields']},
                {'type': 'update', 'id': style['id'], 'name': name, 'fields': {}},
                {'type': 'copy', 'id': style['id'], 'name': name, 'fields': {}},
            ):
                with self.subTest(name=name, operation=operation['type']), self.assertRaises(AssError):
                    apply_style_operation(document, operation)
            for mode in ('copy', 'scale'):
                with self.subTest(name=name, mode=mode), self.assertRaises(AssError):
                    import_style(document, template, name, mode)
            edited = deepcopy(document)
            edited['styles'][1]['name'] = name
            with self.assertRaises(AssError):
                serialize_ass(edited)
        self.assertEqual(document, original)

    def test_normal_case_distinct_names_and_default_remain_supported(self):
        source = basic().replace('Default', 'foo').replace('Emphasis', 'Foo')
        document = parse_ass(source)
        names = {style['id']: style['name'] for style in document['styles']}
        self.assertEqual([names[cue['style_id']] for cue in document['cues']], ['foo', 'Foo'])
        self.assertEqual([s['name'] for s in parse_ass(serialize_ass(document))['styles']], ['foo', 'Foo'])
        self.assertEqual(parse_ass(basic())['styles'][0]['name'], 'Default')
