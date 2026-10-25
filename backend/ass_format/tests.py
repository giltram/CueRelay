from copy import deepcopy
from pathlib import Path
import unittest

import pysubs2
from ass_format import AssError, empty_document, parse_ass, serialize_ass

FIXTURES = Path(__file__).with_name("fixtures")


def basic_source():
    return (FIXTURES / "basic.ass").read_text(encoding="utf-8")


def named_cues(document):
    names = {style['id']: style['name'] for style in document['styles']}
    return [{**{k: v for k, v in cue.items() if k != 'style_id'}, 'style': names[cue['style_id']]} for cue in document['cues']]


class CodecTests(unittest.TestCase):
    def test_basic_roundtrip_preserves_semantics_and_anchors(self):
        source = basic_source()
        document = parse_ass(source)
        output = serialize_ass(document)
        self.assertEqual(named_cues(parse_ass(output)), named_cues(document))
        self.assertEqual([s["name"] for s in parse_ass(output)["styles"]], ["Default", "Emphasis"])
        self.assertIn("; Keep this anchor", output)
        self.assertIn("Comment: 0,0:00:02.00,0:00:02.50,Default,备注,0000,0000,0000,,保留注释", output)
        original, exported = (pysubs2.SSAFile.from_string(s, format_="ass") for s in (source, output))
        self.assertEqual(original.events, exported.events)
        self.assertEqual(original.styles, exported.styles)
        self.assertEqual(original.info, exported.info)
        self.assertEqual(document["cues"][0]["start_ms"], 1200)
        self.assertEqual(document["cues"][0]["text"], "你好，世界\\N第二行, with comma")

    def test_edits_and_new_events_keep_expected_changes_only(self):
        document = parse_ass(basic_source())
        original = deepcopy(document)
        document["cues"][0].update(start_ms=1230, end_ms=3450, text="修改中文\\N换行{\\u1}强调{\\u0}", style_id=document["styles"][1]["id"])
        document["cues"].append({"id": "new-example", "start_ms": 200, "end_ms": 500, "style_id": document["styles"][0]["id"], "text": "追加行"})
        # The chronological view may sort, but export keeps original event order.
        document["cues"].reverse()
        output = serialize_ass(document)
        result = parse_ass(output)
        self.assertEqual(result["cues"][0]["start_ms"], 1230)
        self.assertEqual(result["cues"][0]["text"], "修改中文\\N换行{\\u1}强调{\\u0}")
        self.assertEqual(named_cues(result)[0]["style"], "Emphasis")
        self.assertEqual(named_cues(result)[1], named_cues(original)[1])
        self.assertEqual(result["cues"][2]["text"], "追加行")
        self.assertIn("译者,0000,0000,0000,,", output)
        self.assertIn("Comment:", output)

    def test_time_grid_and_zero_length_rejected(self):
        for start, end in [(0, 0), (10, 10), (20, 10), (-10, 100), (1, 100), (0, 101), (True, 100), (0, 100.0), (0, 36_000_000)]:
            with self.subTest(start=start, end=end):
                document = parse_ass(basic_source())
                document["cues"][0].update(start_ms=start, end_ms=end)
                with self.assertRaises(AssError):
                    serialize_ass(document)
        with self.assertRaises(AssError):
            parse_ass(basic_source().replace("0:00:03.40", "0:00:01.20"))

    def test_reordered_format_is_mapped_before_pysubs2(self):
        source = basic_source().replace("Layer, Start, End", "Start, Layer, End")
        source = source.replace("Dialogue: 0,0:00:01.20,", "Dialogue: 0:00:01.20,0,")
        source = source.replace("Comment: 0,0:00:02.00,", "Comment: 0:00:02.00,0,")
        source = source.replace("Dialogue: 1,0:00:02.50,", "Dialogue: 0:00:02.50,1,")
        document = parse_ass(source)
        self.assertEqual(document["cues"][0]["start_ms"], 1200)
        self.assertEqual(named_cues(parse_ass(serialize_ass(document))), named_cues(document))

    def test_unsupported_content_is_rejected_including_comment_and_edited_text(self):
        unsupported = (FIXTURES / "unsupported.ass").read_text()
        for source in [unsupported, unsupported.replace("Dialogue:", "Comment:"),
                       basic_source() + "\n[Fonts]\nfontname: example.ttf\n",
                       basic_source().replace("MarginV, Effect", "MarginV, Unknown"),
                       basic_source().replace("0000,,你好", "0000,scroll,你好")]:
            with self.subTest(source=source[-100:]):
                with self.assertRaises(AssError) as caught:
                    parse_ass(source)
                self.assertTrue(caught.exception.issue["message"])
                self.assertIn("line", caught.exception.issue)
        for text in [r"{\k20}唱词", r"{\fnArial}字体", "literal { braces", "actual\nnewline", r"{\t(0,100,\b1)}动画"]:
            document = parse_ass(basic_source())
            document["cues"][0]["text"] = text
            with self.assertRaises(AssError):
                serialize_ass(document)

    def test_unknown_style_duplicate_ids_and_extra_fields_rejected(self):
        for patch in [{"style_id": "missing"}, {"id": "unknown"}, {"extra": "unaccepted"}]:
            document = parse_ass(basic_source())
            document["cues"][0].update(patch)
            with self.assertRaises(AssError):
                serialize_ass(document)
        document = parse_ass(basic_source())
        document["cues"].append(document["cues"][0])
        with self.assertRaises(AssError):
            serialize_ass(document)

    def test_bom_metadata_and_empty_document(self):
        source = "\ufeff" + basic_source().replace("[V4+ Styles]", "[Aegisub Project Garbage]\nVideo File: https://example.invalid/private.mp4\n\n[V4+ Styles]")
        output = serialize_ass(parse_ass(source))
        self.assertIn("Video File: https://example.invalid/private.mp4", output)
        self.assertEqual(empty_document()["cues"], [])
        self.assertEqual(parse_ass(serialize_ass(empty_document()))["cues"], [])
        # splitlines must not turn embedded controls into new comment records.
        with self.assertRaises(AssError):
            parse_ass(basic_source().replace("你好，世界\\N第二行, with comma", "中文\x0b;隐藏内容"))

    def test_parser_candidate_loses_semicolon_comments_without_adapter(self):
        # This regression documents why the adapter cannot be removed casually.
        plain = pysubs2.SSAFile.from_string(basic_source(), format_="ass").to_string("ass")
        self.assertNotIn("; Keep this anchor", plain)
        self.assertIn("; Keep this anchor", serialize_ass(parse_ass(basic_source())))
