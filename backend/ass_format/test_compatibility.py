"""Dated audit regressions; explicit expectations, not parser self-consistency."""
from pathlib import Path
import unittest

from ass_format import AssError, empty_document, parse_ass, serialize_ass
from ass_format.codec import MAX_BYTES

FIXTURES = Path(__file__).with_name('fixtures')


def basic():
    return (FIXTURES / 'basic.ass').read_text(encoding='utf-8')


class AuditRegressionTests(unittest.TestCase):
    def test_f1_noncanonical_structured_script_keys_rejected_at_source_line(self):
        for key in ('PlayResX', 'PlayResY', 'ScaledBorderAndShadow'):
            for variant in (key.lower(), key + ' ', key.upper()):
                with self.subTest(key=variant):
                    source = basic().replace(key + ':', variant + ':')
                    with self.assertRaises(AssError) as caught:
                        parse_ass(source)
                    self.assertEqual(caught.exception.issue['line'], next(
                        i for i, line in enumerate(source.splitlines(), 1) if line.startswith(variant + ':')))
                    self.assertIn(key, caught.exception.issue['message'])

    def test_f2_renderer_alias_style_names_rejected_without_merging(self):
        for name in ('*Default', '**Default', '*Other'):
            with self.subTest(name=name):
                with self.assertRaises(AssError) as caught:
                    parse_ass(basic().replace('Emphasis', name))
                self.assertEqual(caught.exception.issue['line'], 14)
                self.assertIn('样式', caught.exception.issue['message'])

    def test_f3_python_only_numeric_syntax_rejected_in_each_decimal_field(self):
        from ass_format.styles import NUMBERS
        for field in NUMBERS:
            for value in ('2_8', '２８', '٢٨', '2e２'):
                lines = basic().splitlines()
                fields = lines[11].removeprefix('Format: ').split(', ')
                parts = lines[12].removeprefix('Style: ').split(',')
                parts[fields.index(field)] = value
                lines[12] = 'Style: ' + ','.join(parts)
                with self.subTest(field=field, value=value):
                    with self.assertRaises(AssError) as caught:
                        parse_ass('\n'.join(lines))
                    self.assertEqual(caught.exception.issue['line'], 13)
                    self.assertIn(field, caught.exception.issue['message'])

    def test_f4_leading_ascii_whitespace_references_normalize_for_dialogue_and_comment(self):
        source = basic().replace(',Default,', ', \tDefault,').replace(',Emphasis,', ', Emphasis,')
        document = parse_ass(source)
        self.assertEqual([cue['style_id'] for cue in document['cues']], [s['id'] for s in document['styles']])
        output = serialize_ass(document)
        self.assertIn(',Default,备注,', output)
        self.assertNotIn(', \tDefault,', output)

    def test_f4_trailing_or_non_ascii_reference_whitespace_rejected_before_fallback(self):
        for kind in ('Dialogue', 'Comment'):
            for name in (' Default ', 'Emphasis ', '\u00a0Default', 'Default\t'):
                lines = basic().splitlines()
                index = next(i for i, line in enumerate(lines) if line.startswith(kind + ':'))
                lines[index] = lines[index].replace(',Default,', ',' + name + ',')
                with self.subTest(kind=kind, name=name):
                    with self.assertRaises(AssError) as caught:
                        parse_ass('\n'.join(lines))
                    self.assertEqual(caught.exception.issue['line'], index + 1)
                    self.assertIn('空白', caught.exception.issue['message'])

    def test_f4_missing_reference_located_even_if_style_section_follows_events(self):
        source = basic()
        head, tail = source.split('[V4+ Styles]')
        styles, events = tail.split('[Events]')
        source = head + '[Events]' + events + '\n[V4+ Styles]' + styles
        for kind in ('Dialogue', 'Comment'):
            lines = source.splitlines()
            index = next(i for i, line in enumerate(lines) if line.startswith(kind + ':'))
            lines[index] = lines[index].replace(',Default,', ', Missing,')
            with self.subTest(kind=kind):
                with self.assertRaises(AssError) as caught:
                    parse_ass('\n'.join(lines))
                self.assertEqual(caught.exception.issue['line'], index + 1)
                self.assertIn('Missing', caught.exception.issue['message'])

    def test_f5_import_checks_normalized_output_budget_before_acceptance(self):
        source = empty_document()['source']
        source += ';' + 'x' * (MAX_BYTES - len(source.encode()) - 1)
        self.assertEqual(len(source.encode()), MAX_BYTES)
        with self.assertRaises(AssError) as caught:
            parse_ass(source)
        self.assertIn('1MiB', caught.exception.issue['message'])

    def test_f5_output_expansion_from_record_spacing_is_also_preflighted(self):
        source = basic().replace('Dialogue: ', 'Dialogue:').replace('Style: ', 'Style:')
        source += ';' + 'x' * (MAX_BYTES - len(source.encode()) - 2) + '\n'
        self.assertEqual(len(source.encode()), MAX_BYTES)
        with self.assertRaises(AssError):
            parse_ass(source)


CORPUS = FIXTURES / 'compatibility'


def corpus_manifest():
    import json
    return json.loads((CORPUS / 'expected.json').read_text(encoding='utf-8'))


def assert_document(test, document, expected):
    """Hand-authored semantics shared by codec, HTTP and persisted-project tests."""
    names = {style['id']: style['name'] for style in document['styles']}
    test.assertEqual(document['script'], expected['script'])
    test.assertEqual({style['name']: style['fields'] for style in document['styles']}, expected['styles'])
    test.assertEqual([
        {'start_ms': cue['start_ms'], 'end_ms': cue['end_ms'], 'text': cue['text'], 'style': names[cue['style_id']]}
        for cue in document['cues']], expected['cues'])


def assert_output(test, output, expected):
    # Exact records independently verify hidden Layer/Name/Margins/Comment and
    # event order. A second parse alone could share the serializer's mistakes.
    test.assertEqual([line for line in output.splitlines() if line.startswith(('Dialogue:', 'Comment:'))], expected['events'])
    for line in expected['preserved_lines']:
        test.assertIn(line, output.splitlines())
    test.assertTrue(output.endswith('\n'))
    test.assertNotIn('\r', output)


class CompatibilityCorpusTests(unittest.TestCase):
    def test_authored_corpus_and_roundtrip_match_manual_expectations(self):
        for filename, expected in corpus_manifest()['valid'].items():
            with self.subTest(filename=filename):
                source = (CORPUS / filename).read_text(encoding='utf-8')
                document = parse_ass(source)
                assert_document(self, document, expected)
                output = serialize_ass(document)
                assert_output(self, output, expected)
                assert_document(self, parse_ass(output), expected)

    def test_invalid_corpus_has_explicit_source_location_and_no_partial_result(self):
        for filename, expected in corpus_manifest()['invalid'].items():
            with self.subTest(filename=filename):
                with self.assertRaises(AssError) as caught:
                    parse_ass((CORPUS / filename).read_text(encoding='utf-8'))
                self.assertEqual(caught.exception.issue['line'], expected['line'])
                self.assertIn(expected['message'], caught.exception.issue['message'])

    def test_bom_line_endings_and_reference_whitespace_preserve_semantics(self):
        source = (CORPUS / 'text-and-metadata.ass').read_text(encoding='utf-8')
        expected = corpus_manifest()['valid']['text-and-metadata.ass']
        for ending in ('\n', '\r\n', '\r', 'mixed'):
            for bom in ('', '\ufeff'):
                with self.subTest(ending=ending, bom=bool(bom)):
                    lines = source.splitlines()
                    variant = ''.join(line + (('\r\n' if i % 2 else '\n') if ending == 'mixed' else ending)
                                      for i, line in enumerate(lines))
                    variant = variant.replace(',Default,译者,', ', \tDefault,译者,')
                    variant = variant.replace(',强调,备注,', ', 强调,备注,')
                    document = parse_ass(bom + variant)
                    assert_document(self, document, expected)
                    assert_output(self, serialize_ass(document), expected)

    def test_text_leading_and_trailing_spaces_remain_data(self):
        source = basic().replace('保留注释', '  comment  ').replace(
            r'你好，世界\N第二行, with comma', r'  正文,\N\n\h  ')
        document = parse_ass(source)
        self.assertEqual(document['cues'][0]['text'], r'  正文,\N\n\h  ')
        output = serialize_ass(document)
        self.assertIn(',0000,,  正文,\\N\\n\\h  \n', output)
        self.assertIn(',0000,,  comment  \n', output)
        self.assertEqual(parse_ass(output)['cues'][0]['text'], r'  正文,\N\n\h  ')

    def test_invalid_mutations_rejected_instead_of_dropping_content(self):
        source = basic()
        cases = [
            ('duplicate section', source + '\n[Events]\n', 'section'),
            ('duplicate format', source.replace('Dialogue: 0,', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,'), 'Format'),
            ('duplicate style', source.replace('Style: Emphasis,', 'Style: Default,'), '重复'),
            ('duplicate script case', source.replace('PlayResX: 640', 'PlayResX: 640\nplayresx: 640'), '重复'),
            ('invalid resolution', source.replace('PlayResX: 640', 'PlayResX: 0'), 'PlayRes'),
            ('missing event value', source.replace(',Emphasis,,0010,', ',Emphasis,0010,'), '字段数'),
            ('unknown format field', source.replace('Name, MarginL, MarginR, MarginV, Effect', 'Actor, MarginL, MarginR, MarginV, Effect'), 'Format'),
            ('text not last', source.replace('Effect, Text', 'Text, Effect'), 'Text'),
            ('unknown event', source.replace('Dialogue:', 'Picture:', 1), '事件'),
            ('effect in comment', source.replace('0000,,保留注释', '0000,Scroll up,保留注释'), 'Effect'),
            ('bad precision', source.replace('0:00:01.20', '0:00:01.2'), 'h:mm:ss.cc'),
            ('zero duration', source.replace('0:00:03.40', '0:00:01.20'), '早于'),
            ('invalid minute', source.replace('0:00:01.20', '0:60:01.20'), 'h:mm:ss.cc'),
            ('ssa', source.replace('v4.00+', 'v4.00'), 'v4.00+'),
            ('drawing', source.replace('保留注释', r'{\p1}m 0 0 l 1 1'), '标签'),
            ('animation', source.replace('保留注释', r'{\t(0,100,\b1)}x'), '标签'),
            ('unknown escape', source.replace('保留注释', r'bad\q'), '转义'),
            ('trailing slash', source.replace('保留注释', 'bad\\'), '转义'),
            ('unpaired brace', source.replace('保留注释', 'bad}'), '花括号'),
            ('control', source.replace('保留注释', 'bad\x00'), '控制字符'),
            ('unicode separator', source.replace('保留注释', 'bad\u2028text'), '非标准换行'),
            ('invalid unicode', source.replace('保留注释', '\ud800'), 'Unicode'),
        ]
        for name, variant, message in cases:
            with self.subTest(case=name):
                with self.assertRaises(AssError) as caught:
                    parse_ass(variant)
                self.assertIn(message, caught.exception.issue['message'])

    def test_size_boundary_uses_utf8_bytes_and_accepts_exportable_maximum(self):
        source = empty_document()['source']
        padding = MAX_BYTES - len(source.encode()) - len(';中文\n'.encode())
        source += ';中文' + 'x' * padding + '\n'
        self.assertEqual(len(source.encode()), MAX_BYTES)
        self.assertEqual(serialize_ass(parse_ass(source)), source)
        with self.assertRaises(AssError):
            parse_ass(source + 'x')

    def test_event_count_and_text_length_include_protected_comments(self):
        header = empty_document()['source']
        event = 'Comment: 0,0:00:00.00,0:00:00.01,Default,,0000,0000,0000,,x\n'
        self.assertEqual(parse_ass(header + event * 5000)['cues'], [])
        for source in (header + event * 5001, header + event.replace(',,x', ',,' + 'x' * 16385)):
            with self.assertRaises(AssError):
                parse_ass(source)


class StyleBoundaryRegressionTests(unittest.TestCase):
    def test_alias_names_rejected_by_create_rename_copy_template_and_export(self):
        from copy import deepcopy
        from uuid import uuid4
        from ass_format import apply_style_operation, import_style
        document = parse_ass(basic())
        original = deepcopy(document)
        style = document['styles'][0]
        template = {'id': str(uuid4()), 'revision': 1, 'fields': style['fields'], 'reference': document['script']}
        operations = [
            {'type': 'create', 'name': '*Default', 'fields': style['fields']},
            {'type': 'update', 'id': style['id'], 'name': '*Default', 'fields': {}},
            {'type': 'copy', 'id': style['id'], 'name': '*Default', 'fields': {}},
        ]
        for operation in operations:
            with self.subTest(operation=operation['type']), self.assertRaises(AssError):
                apply_style_operation(document, operation)
        with self.assertRaises(AssError):
            import_style(document, template, '*Default', 'copy')
        edited = deepcopy(document)
        edited['styles'][0]['name'] = '*Default'
        with self.assertRaises(AssError):
            serialize_ass(edited)
        self.assertEqual(document, original)
        # Font names do not have ASS style identity semantics.
        result = apply_style_operation(document, {'type': 'update', 'id': style['id'], 'name': 'Default', 'fields': {'Fontname': '*Font'}})
        self.assertEqual(result['styles'][0]['fields']['Fontname'], '*Font')

    def test_numeric_lexical_boundary_shared_by_operations_templates_and_scaling(self):
        from copy import deepcopy
        from uuid import uuid4
        from ass_format import apply_style_operation, import_style, adapt_fields
        document = parse_ass(basic())
        original = deepcopy(document)
        style = document['styles'][0]
        for value in ('2_8', '２８', '٢٨', '2e２', '28junk', 'NaN', 'Infinity'):
            fields = {**style['fields'], 'Fontsize': value}
            for operation in [
                {'type': 'create', 'name': 'New', 'fields': fields},
                {'type': 'update', 'id': style['id'], 'name': 'Default', 'fields': {'Fontsize': value}},
                {'type': 'batch', 'ids': [style['id']], 'fields': {'Fontsize': value}},
            ]:
                with self.subTest(value=value, operation=operation['type']), self.assertRaises(AssError):
                    apply_style_operation(document, operation)
            template = {'id': str(uuid4()), 'revision': 1, 'fields': fields, 'reference': document['script']}
            for mode in ('copy', 'scale'):
                with self.subTest(value=value, mode=mode), self.assertRaises(AssError):
                    import_style(document, template, 'New', mode)
                with self.assertRaises(AssError):
                    adapt_fields(fields, document['script'], document['script'], mode)
            edited = deepcopy(document)
            edited['styles'][0]['fields'] = fields
            with self.assertRaises(AssError):
                serialize_ass(edited)
        self.assertEqual(document, original)

    def test_ascii_decimal_forms_remain_supported_and_scale_as_expected(self):
        from ass_format import adapt_fields
        document = parse_ass(basic())
        reference = document['script']
        target = {**reference, 'play_res_x': 1280, 'play_res_y': 720}
        for value, scaled in [('28', '56'), ('+28', '56'), ('28.', '56'), ('.5', '1'), ('2.8e1', '56'), ('28E+0', '56')]:
            with self.subTest(value=value):
                fields = {**document['styles'][0]['fields'], 'Fontsize': value}
                self.assertEqual(adapt_fields(fields, reference, target, 'scale')['Fontsize'], scaled)
