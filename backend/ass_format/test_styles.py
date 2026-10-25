"""Identity, raw metadata and conservative adaptation contracts independent of Django."""
from copy import deepcopy
from pathlib import Path
import unittest
from uuid import uuid4
import pysubs2
from ass_format import (AssError, empty_document, parse_ass, serialize_ass,
                        apply_style_operation, import_style, style_usage, adapt_fields)
from ass_format.migration import upgrade_legacy_document


class StyleTests(unittest.TestCase):
    def setUp(self):
        self.doc = empty_document()
        self.style = self.doc['styles'][0]
        self.doc['cues'] = [{'id': 'new-cue', 'start_ms': 0, 'end_ms': 1000, 'text': '人物', 'style_id': self.style['id']}]

    def op(self, **operation):
        return apply_style_operation(self.doc, operation)

    def test_update_and_rename_preserve_ids_and_affect_export(self):
        result = self.op(type='update', id=self.style['id'], name='人物甲', fields={'Fontsize': '55', 'PrimaryColour': '&H80332211'})
        self.assertEqual(result['cues'], self.doc['cues'])
        self.assertEqual(result['styles'][0]['id'], self.style['id'])
        parsed = pysubs2.SSAFile.from_string(serialize_ass(result), format_='ass')
        self.assertEqual(parsed.events[0].style, '人物甲')
        self.assertEqual(parsed.styles['人物甲'].fontsize, 55)
        self.assertEqual(parsed.styles['人物甲'].primarycolor.a, 128)
        self.assertEqual(self.style['name'], 'Default')

    def test_copy_independent_color_batch_only_explicit_fields_and_assignment(self):
        first = self.op(type='copy', id=self.style['id'], name='乙', fields={'PrimaryColour': '&H000000FF'})
        second = first['styles'][1]
        self.assertNotEqual(second['id'], self.style['id'])
        result = apply_style_operation(first, {'type': 'batch', 'ids': [s['id'] for s in first['styles']], 'fields': {'Fontsize': '55'}})
        self.assertEqual([s['fields']['Fontsize'] for s in result['styles']], ['55', '55'])
        self.assertEqual([s['fields']['PrimaryColour'] for s in result['styles']], ['&H00FFFFFF', '&H000000FF'])
        assigned = apply_style_operation(result, {'type': 'assign', 'cue_ids': ['new-cue'], 'style_id': second['id']})
        self.assertEqual(assigned['cues'][0]['style_id'], second['id'])
        self.assertEqual(first['styles'][0]['fields']['Fontsize'], '28')

    def test_used_last_and_comment_styles_cannot_be_deleted(self):
        with self.assertRaises(AssError):
            self.op(type='delete', ids=[self.style['id']])
        empty = empty_document()
        with self.assertRaises(AssError):
            apply_style_operation(empty, {'type': 'delete', 'ids': [empty['styles'][0]['id']]})
        source = (Path(__file__).with_name('fixtures') / 'basic.ass').read_text()
        document = parse_ass(source)
        document['cues'] = []
        default = document['styles'][0]
        self.assertEqual(style_usage(document)[default['id']], {'cues': 0, 'comments': 1})
        with self.assertRaises(AssError):
            apply_style_operation(document, {'type': 'delete', 'ids': [default['id']]})
        renamed = apply_style_operation(document, {'type': 'update', 'id': default['id'], 'name': 'Renamed', 'fields': {}})
        exported = serialize_ass(renamed)
        self.assertIn('0:00:02.50,Renamed,备注', exported)
        self.assertIn('; Keep this anchor', exported)
        deleted = apply_style_operation(renamed, {'type': 'delete', 'ids': [document['styles'][1]['id']]})
        self.assertEqual(len(parse_ass(serialize_ass(deleted))['styles']), 1)

    def test_invalid_operations_are_all_or_nothing(self):
        before = deepcopy(self.doc)
        for operation in [
            {'type': 'update', 'id': self.style['id'], 'name': 'bad,name', 'fields': {}},
            {'type': 'batch', 'ids': [self.style['id'], str(uuid4())], 'fields': {'Fontsize': '55'}},
            {'type': 'batch', 'ids': [self.style['id']] * 2, 'fields': {'Fontsize': '55'}},
            {'type': 'batch', 'ids': [self.style['id']], 'fields': {'Name': 'all'}},
            {'type': 'batch', 'ids': [self.style['id']], 'fields': {'Fontsize': 'NaN'}},
            {'type': 'copy', 'id': self.style['id'], 'name': 'Default', 'fields': {}},
            {'type': 'create', 'name': 'Copy', 'fields': {'Fontsize': '55'}},
            {'type': 'assign', 'cue_ids': ['new-cue', 'missing'], 'style_id': self.style['id']},
            {'type': 'assign', 'cue_ids': ['new-cue'], 'style_id': str(uuid4())},
            {'type': 'script', 'script': {'play_res_x': True, 'play_res_y': 720, 'scaled_border_and_shadow': True}},
        ]:
            with self.subTest(operation=operation), self.assertRaises(AssError):
                apply_style_operation(self.doc, operation)
            self.assertEqual(before, self.doc)

    def test_copy_on_import_and_source_revision_are_snapshots(self):
        template = {'id': str(uuid4()), 'revision': 2, 'fields': deepcopy(self.style['fields']), 'reference': self.doc['script']}
        result = import_style(self.doc, template, 'Template', 'copy')
        template['fields']['Fontsize'] = '100'
        self.assertEqual(result['styles'][-1]['fields']['Fontsize'], '28')
        self.assertEqual(result['styles'][-1]['origin'], {'template_id': template['id'], 'revision': 2})
        self.assertIsNone(result['styles'][-1]['source_name'])

    def test_scale_rules_rounding_and_aspect_guard(self):
        target = {'play_res_x': 960, 'play_res_y': 540, 'scaled_border_and_shadow': True}
        fields = {**self.style['fields'], 'MarginL': '1', 'ScaleX': '95', 'Shadow': '1.25', 'Spacing': '0.1'}
        result = adapt_fields(fields, self.doc['script'], target, 'scale')
        self.assertEqual({k: result[k] for k in ['Fontsize', 'MarginL', 'ScaleX', 'Shadow', 'Spacing']},
                         {'Fontsize': '42', 'MarginL': '2', 'ScaleX': '95', 'Shadow': '1.875', 'Spacing': '0.15'})
        for key in ['PrimaryColour', 'Angle', 'Alignment', 'Bold', 'Encoding']:
            self.assertEqual(result[key], fields[key])
        for invalid in [{**target, 'play_res_x': 720}, {**target, 'scaled_border_and_shadow': False}, {**target, 'play_res_y': None}]:
            with self.assertRaises(AssError):
                adapt_fields(fields, self.doc['script'], invalid, 'scale')
            self.assertEqual(adapt_fields(fields, self.doc['script'], invalid, 'copy'), fields)

    def test_script_overlay_and_missing_values_do_not_reanchor_cues(self):
        doc = parse_ass((Path(__file__).with_name('fixtures') / 'basic.ass').read_text())
        ids = [cue['id'] for cue in doc['cues']]
        script = {'play_res_x': 1920, 'play_res_y': 1080, 'scaled_border_and_shadow': True}
        changed = apply_style_operation(doc, {'type': 'script', 'script': script})
        self.assertEqual([cue['id'] for cue in changed['cues']], ids)
        self.assertEqual(parse_ass(serialize_ass(changed))['script'], script)
        for source in [doc['source'].replace('PlayResX:', 'PlayResX: 0\n;'), doc['source'].replace('[V4+ Styles]', 'PlayResY: 720\n[V4+ Styles]')]:
            with self.assertRaises(AssError):
                parse_ass(source)

    def test_migration_preserves_edits_split_anchors_and_comment_semantics(self):
        source = (Path(__file__).with_name('fixtures') / 'basic.ass').read_text()
        fresh = parse_ass(source)
        names = {s['id']: s['name'] for s in fresh['styles']}
        legacy = {'source': source, 'styles': list(names.values()), 'cues': [
            {**{k: v for k, v in cue.items() if k != 'style_id'}, 'style': names[cue['style_id']]} for cue in fresh['cues']]}
        legacy['cues'][0].update(text='已修改', start_ms=1230)
        legacy['cues'][1]['source_id'] = legacy['cues'][1]['id']
        legacy['cues'][1]['id'] = 'new-split'
        upgraded = upgrade_legacy_document(legacy)
        self.assertEqual([c['id'] for c in upgraded['cues']], [c['id'] for c in legacy['cues']])
        parsed = pysubs2.SSAFile.from_string(serialize_ass(upgraded), format_='ass')
        self.assertEqual(parsed.events[0].text, '已修改')
        self.assertEqual(parsed.events[0].start, 1230)
        self.assertTrue(any(e.is_comment for e in parsed.events))
        original = pysubs2.SSAFile.from_string(source, format_='ass')
        self.assertEqual(original.styles, parsed.styles)
        self.assertEqual(original.info, parsed.info)
        with self.assertRaises(AssError):
            serialize_ass(legacy)  # Old API callers cannot silently overwrite migrated data.

    def test_reordered_style_format_and_metadata_survive_added_styles(self):
        source = self.doc['source'].replace('Name, Fontname', 'Fontname, Name').replace('Default,Local Test Font', 'Local Test Font,Default')
        document = parse_ass(source)
        result = apply_style_operation(document, {'type': 'copy', 'id': document['styles'][0]['id'], 'name': 'Copy', 'fields': {}})
        output = serialize_ass(result)
        self.assertIn('Style: Local Test Font,Copy,', output)
        self.assertEqual(len(parse_ass(output)['styles']), 2)
