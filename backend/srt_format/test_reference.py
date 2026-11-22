from django.test import SimpleTestCase
from srt_format import SrtError, parse_reference_srt, parse_srt


class ReferenceSrtTests(SimpleTestCase):
    def test_milliseconds_order_empty_and_literal_ass_characters(self):
        source = '\ufeff9\r\n00:00:02,001 --> 00:00:02,004\r\n<b>中文 &amp; 😀</b>\r\n{literal} \\N &lt;b&gt;\r\n\r\n0\r\n00:00:01,000 --> 00:00:01,000\r\n'
        self.assertEqual(parse_reference_srt(source), [
            {'start_ms': 2001, 'end_ms': 2004, 'text': '中文 & 😀\n{literal} \\N <b>'},
            {'start_ms': 1000, 'end_ms': 1000, 'text': ''}])
        self.assertEqual(parse_reference_srt(''), [])
        self.assertEqual(parse_reference_srt('1\n00:00:01,234 --> 00:00:01,235\nx')[0]['end_ms'], 1235)
        self.assertEqual(parse_srt('1\n00:00:01,234 --> 00:00:01,235\nx')['cues'][0]['end_ms'], 1240)

    def test_shared_markup_entities_and_strict_framing(self):
        for body in ['<script>x</script>', '<font color="red">x</font>', '<b>unclosed', '<i><b>x</i></b>', '&unknown;', '&#0;', '\x00', 'a\rb']:
            with self.subTest(body=body), self.assertRaises(SrtError):
                parse_reference_srt('1\n00:00:00,000 --> 00:00:01,000\n' + body)
        for source in ['garbage', '1\n00:00:01,004 --> 00:00:01,001\nx', '\ud800', 'x' * (1024*1024+1),
                       '1\n00:00:00,000 --> 00:00:01,000\n' + 'x'*16385,
                       '\n\n'.join('1\n00:00:00,000 --> 00:00:01,000\nx' for _ in range(5001))]:
            with self.subTest(source=source[:50]), self.assertRaises(SrtError):
                parse_reference_srt(source)
        self.assertEqual(parse_reference_srt('1\n00:00:00,000 --> 00:00:01,000\n<b><b>x</b>y</b>&amp;amp;')[0]['text'], 'xy&amp;')
