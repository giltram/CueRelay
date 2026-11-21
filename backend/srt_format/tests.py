"""Authored expectations for our SRT subset, not the permissive library parser."""
from copy import deepcopy
import unittest

from ass_format import AssError, MAX_BYTES, empty_document, parse_ass, serialize_ass
from srt_format import SrtError, parse_srt, serialize_srt
from .blocks import read_blocks


def block(text='中文 😀', start='00:00:01,230', end='00:00:02,340', number='1'):
    return f'{number}\n{start} --> {end}\n{text}'


def semantics(document):
    return [(cue['start_ms'], cue['end_ms'], cue['text']) for cue in document['cues']]


class SrtTests(unittest.TestCase):
    def test_utf8_bom_lf_crlf_multiline_and_no_final_separator(self):
        for bom in ('', '\ufeff'):
            for newline in ('\n', '\r\n'):
                for suffix in ('', '\n', '\n\n'):
                    with self.subTest(bom=bom, newline=newline, suffix=suffix):
                        document = parse_srt(bom + (block(' 首行 &amp; 😀\n次行  ') + suffix).replace('\n', newline))
                        self.assertEqual(semantics(document), [(1230, 2340, ' 首行 & 😀\\N次行  ')])
                        self.assertEqual(document['script'], empty_document()['script'])
                        self.assertEqual(document['styles'][0]['fields'], empty_document()['styles'][0]['fields'])
                        self.assertEqual(semantics(parse_ass(document['source'])), semantics(document))

    def test_empty_files_empty_text_duplicate_numbers_overlap_and_event_order(self):
        for source in ('', '\ufeff', '\n\n'):
            self.assertEqual(parse_srt(source)['cues'], [])
        source = '\n\n'.join([
            block('', '00:00:03,000', '00:00:03,000', '99'),
            block('早', '00:00:01,000', '00:00:04,000', '99'),
            block('重叠', '00:00:02,000', '00:00:04,000', '0'),
        ])
        document = parse_srt(source)
        self.assertEqual(semantics(document), [(3000, 3000, ''), (1000, 4000, '早'), (2000, 4000, '重叠')])
        output = serialize_srt(document)
        self.assertEqual(output, '\n\n'.join([
            block('', '00:00:03,000', '00:00:03,000', '1'),
            block('早', '00:00:01,000', '00:00:04,000', '2'),
            block('重叠', '00:00:02,000', '00:00:04,000', '3'),
        ]) + '\n\n')
        self.assertEqual(semantics(parse_srt(output)), semantics(document))

    def test_rounding_half_up_zero_duration_boundaries_and_original_time_validation(self):
        for start, end, expected in [
            ('00:00:01,234', '00:00:01,235', (1230, 1240)),
            ('00:00:01,231', '00:00:01,234', (1230, 1230)),
            ('00:00:00,000', '00:00:00,005', (0, 10)),
            ('00:00:59,995', '00:01:00,004', (60000, 60000)),
            ('09:59:59,986', '09:59:59,990', (35999990, 35999990)),
        ]:
            with self.subTest(start=start, end=end):
                raw = read_blocks(block('x', start, end))[0]
                cue = parse_srt(block('x', start, end))['cues'][0]
                self.assertEqual((cue['start_ms'], cue['end_ms']), expected)
                self.assertLessEqual(abs(raw.start_ms - cue['start_ms']), 5)
                self.assertLessEqual(abs(raw.end_ms - cue['end_ms']), 5)
        for start, end in [('00:00:01,234', '00:00:01,231'), ('09:59:59,990', '09:59:59,991'), ('10:00:00,000', '10:00:00,001')]:
            with self.assertRaises(SrtError):
                parse_srt(block('x', start, end))
        # Monotone quantization never reverses adjoining boundaries.
        doc = parse_srt(block('a', '00:00:00,994', '00:00:00,995') + '\n\n' + block('b', '00:00:00,996', '00:00:01,001'))
        self.assertEqual([(c['start_ms'], c['end_ms']) for c in doc['cues']], [(990, 1000), (1000, 1000)])

    def test_markup_entities_nested_state_and_literal_angle_brackets(self):
        document = parse_srt(block('<B>粗<i>斜</i></B> <u>线</u><s>删</s>\n<b>外<b>内</b>外</b> &amp; &lt;b&gt; &#x1F600; 1 < 2 > 0'))
        self.assertEqual(document['cues'][0]['text'], r'{\b1}粗{\i1}斜{\i0}{\b0} {\u1}线{\u0}{\s1}删{\s0}\N{\b1}外{\b1}内{\b1}外{\b0} & <b> 😀 1 < 2 > 0')
        srt = serialize_srt(document)
        self.assertIn('&amp; &lt;b&gt; 😀 1 &lt; 2 &gt; 0', srt)
        # Canonical token boundaries may change; effective styled spans do not.
        self.assertEqual(serialize_srt(parse_srt(srt)), srt)
        self.assertNotIn('{', srt)

    def test_no_ass_injection_no_tag_stripping_and_exact_source_locations(self):
        for text, reason in [
            ('{literal}', 'unrepresentableText'), (r'\N', 'unrepresentableText'),
            ('&#123;literal&#125;', 'unrepresentableText'), ('&#92;N', 'unrepresentableText'),
            ('<font color="red">x</font>', 'unsupportedTag'), ('<script>alert(1)</script>', 'unsupportedTag'),
            ('<!-- x -->', 'unsupportedTag'), ('<br>', 'unsupportedTag'), ('<b class=x>x</b>', 'unsupportedTag'),
            ('<b', 'unsupportedTag'), ('</i>', 'unbalancedTag'), ('<b>x', 'unbalancedTag'),
            ('<b><i>x</b></i>', 'unbalancedTag'), ('&#xD800;', 'invalidEntity'), ('&#0;', 'invalidEntity'),
            ('&#1114112;', 'invalidEntity'), ('&unknown;', 'invalidEntity'), ('&NewLine;', 'controlCharacter'),
            ('\r', 'controlCharacter'), ('\t', 'controlCharacter'), ('\u2028', 'controlCharacter'),
        ]:
            with self.subTest(text=text), self.assertRaises(SrtError) as caught:
                parse_srt(block('good') + '\n\n' + block('first\n' + text))
            self.assertEqual(caught.exception.issue['reason'], 'srt.' + reason)
            self.assertEqual(caught.exception.issue['block'], 2)
            self.assertEqual(caught.exception.issue['line'], 8)

    def test_broken_blocks_are_not_skipped(self):
        for source, line in [
            ('garbage', 1), ('1', 2), ('1\n00:00:01,000 --> broken\nx', 2),
            ('1\n00:60:00,000 --> 00:61:00,000\nx', 2),
            ('1\n00:00:00.000 --> 00:00:01.000\nx', 2),
            ('1\n00:00:00,000 --> 00:00:01,000 X1:0\nx', 2),
            (block() + '\n2\n00:00:03,000 --> 00:00:04,000\ny', 5),
            (block() + '\n\ngarbage', 5),
        ]:
            with self.subTest(source=source), self.assertRaises(SrtError) as caught:
                parse_srt(source)
            self.assertEqual(caught.exception.issue['line'], line)

    def test_limits_and_invalid_unicode(self):
        for source in (None, 7, {}, '\ud800', '\udfff', '中' * (MAX_BYTES // 3 + 1)):
            with self.subTest(source_type=type(source)), self.assertRaises(SrtError):
                parse_srt(source)
        document = parse_srt(block('x' * 16384))
        self.assertEqual(len(document['cues'][0]['text']), 16384)
        with self.assertRaises(SrtError) as caught:
            parse_srt(block('x' * 16385))
        self.assertEqual(caught.exception.issue['line'], 3)
        self.assertEqual(len(parse_srt('\n\n'.join(block('') for _ in range(5000)))['cues']), 5000)
        with self.assertRaises(SrtError) as caught:
            parse_srt('\n\n'.join(block('') for _ in range(5001)))
        self.assertEqual(caught.exception.issue['block'], 5001)
        # A compact SRT may expand past the unified ASS byte budget.
        compact = '\n\n'.join(block('x' * 160) for _ in range(5000))
        self.assertLess(len(compact.encode('utf-8')), MAX_BYTES)
        with self.assertRaises(AssError):
            parse_srt(compact)

    def test_edit_srt_and_ass_roundtrips_and_export_is_readonly(self):
        document = parse_srt(block('首行\n次行 😀'))
        document['cues'][0].update(start_ms=1240, text=r'已编辑 & <tag>\N\h尾行')
        original = deepcopy(document)
        output = serialize_srt(document)
        self.assertEqual(document, original)
        self.assertEqual(output, block('已编辑 &amp; &lt;tag&gt;\n\u00a0尾行', '00:00:01,240') + '\n\n')
        # NBSP reimports as U+00A0; hard-space semantics persist, not ASS bytes.
        self.assertEqual(semantics(parse_srt(output)), [(1240, 2340, '已编辑 & <tag>\\N\u00a0尾行')])
        self.assertEqual(semantics(parse_ass(serialize_ass(document))), semantics(document))

    def test_style_defaults_override_tags_comments_and_loss_boundaries(self):
        document = parse_srt(block('a'))
        fields = document['styles'][0]['fields']
        fields.update(Bold='-1', Italic='-1', Underline='-1', StrikeOut='-1')
        document['cues'][0]['text'] = r'a{\b0\i0\u0\s0}b{\b1}c\n尾'
        before = deepcopy(document)
        output = serialize_srt(document)
        self.assertIn('<b><i><u><s>a</s></u></i></b>b<b>c\n尾</b>', output)
        self.assertEqual(document, before)
        for text in (r'\Ntext', r'text\N', r'a\N\Nb', r'{\b1}a\N', r'00:00:01,000 --> 00:00:02,000'):
            document['cues'][0]['text'] = text
            with self.subTest(text=text), self.assertRaises(SrtError):
                serialize_srt(document)
        document['cues'][0]['text'] = '{arbitrary}'
        with self.assertRaises(AssError):
            serialize_srt(document)

    def test_output_size_and_invalid_document_are_not_bypassed(self):
        document = parse_srt(block('&' * 16384))
        cue = document['cues'][0]
        document['cues'] = [{**cue, 'id': f'new-{i}'} for i in range(14)]
        with self.assertRaises(SrtError):
            serialize_srt(document)  # &amp; expansion exceeds SRT byte budget.
        document['cues'] = [{**cue, 'start_ms': 1231}]
        with self.assertRaises(AssError):
            serialize_srt(document)

    def test_ass_comments_and_metadata_are_omitted_only_from_the_srt_copy(self):
        source = empty_document()['source'] + '\n'.join([
            'Comment: 0,0:00:00.00,0:00:01.00,Default,Comment author,0000,0000,0000,,private comment',
            r'Dialogue: 3,0:00:01.00,0:00:02.00,Default,Speaker,0010,0020,0030,,{\b1}bold{\b0}\N中文\h😀',
        ]) + '\n'
        document = parse_ass(source)
        before = deepcopy(document)
        self.assertEqual(serialize_srt(document), block('<b>bold</b>\n中文\u00a0😀', '00:00:01,000', '00:00:02,000') + '\n\n')
        self.assertEqual(document, before)
        ass = serialize_ass(document)
        self.assertIn('private comment', ass)
        self.assertIn('Speaker,0010,0020,0030', ass)
        # Independent, installed upstream reader agrees on supported visible text
        # and milliseconds. Our own reader alone is not the roundtrip oracle.
        import pysubs2
        events = pysubs2.SSAFile.from_string(serialize_srt(document), format_='srt')
        self.assertEqual((events[0].start, events[0].end, events[0].plaintext), (1000, 2000, 'bold\n中文\u00a0😀'))
