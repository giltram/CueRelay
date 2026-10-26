"""Fixed v1 inputs protect the deliberate strict upgrade boundary."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from ass_format import AssError, serialize_ass
from ass_format.migration import upgrade_legacy_document

FIXTURES = Path(__file__).with_name('fixtures') / 'legacy-v1'


class LegacyFixtureTests(unittest.TestCase):
    def test_supported_historical_snapshot_preserves_source_and_cue_identity(self):
        legacy = json.loads((FIXTURES / 'valid.json').read_text())
        before = deepcopy(legacy)
        document = upgrade_legacy_document(legacy)
        self.assertEqual(document['source'], legacy['source'])
        self.assertEqual(document['cues'][0]['id'], legacy['cues'][0]['id'])
        self.assertEqual(serialize_ass(document), legacy['source'])
        self.assertEqual(legacy, before)

    def test_historical_values_outside_v2_contract_are_rejected_without_mutation(self):
        for name, reason in [('leading-zero-playres', 'PlayRes'),
                             ('long-style-name', '100'), ('duplicate-playres', '重复')]:
            legacy = json.loads((FIXTURES / f'{name}.json').read_text())
            before = deepcopy(legacy)
            with self.subTest(name=name), self.assertRaisesRegex(AssError, reason):
                upgrade_legacy_document(legacy)
            self.assertEqual(legacy, before)
