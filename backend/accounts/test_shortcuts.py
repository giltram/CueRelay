from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from .shortcuts import DEFAULTS, effective_bindings, validate_overrides


class SubtitleFocusShortcutTests(SimpleTestCase):
    def test_defaults_and_exact_choices(self):
        self.assertEqual(DEFAULTS['toggle-text-focus']['bindings'], ['Tab'])
        self.assertEqual(validate_overrides({'toggle-text-focus': ['Tab']}), {})
        custom = {'toggle-text-focus': ['Ctrl+Space']}
        self.assertEqual(validate_overrides(custom), custom)
        for invalid in [[], ['Tab', 'Ctrl+Space'], ['KeyT'], ['Shift+KeyT'], ['Space'],
                        ['Meta+Space'], ['Ctrl+Shift+Space'], ['Shift+Tab'], [None], [{}]]:
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                validate_overrides({'toggle-text-focus': invalid})

    def test_choice_conflicts_with_other_commands(self):
        validate_overrides({'split-text': ['Ctrl+Space']})
        with self.assertRaises(ValidationError):
            validate_overrides({'toggle-text-focus': ['Ctrl+Space'], 'split-text': ['Ctrl+Space']})


class HistoryShortcutTests(SimpleTestCase):
    def test_shared_defaults_and_custom_history_bindings(self):
        self.assertEqual(DEFAULTS['undo']['bindings'], ['Ctrl+KeyZ', 'Meta+KeyZ'])
        self.assertEqual(DEFAULTS['redo']['bindings'], ['Ctrl+Shift+KeyZ', 'Meta+Shift+KeyZ'])
        for value in [{}, {'undo': []}, {'redo': ['Alt+KeyR']}, {'undo': DEFAULTS['undo']['bindings']}]:
            validate_overrides(value)

    def test_legacy_explicit_bindings_win_over_new_defaults(self):
        legacy = {'split-text': ['Ctrl+KeyZ'], 'split-playhead': ['Meta+Shift+KeyZ']}
        self.assertEqual(validate_overrides(legacy), legacy)
        self.assertEqual(effective_bindings('undo', legacy), ['Meta+KeyZ'])
        self.assertEqual(effective_bindings('redo', legacy), ['Ctrl+Shift+KeyZ'])
        for undo in [['Ctrl+KeyZ'], DEFAULTS['undo']['bindings']]:
            with self.assertRaises(ValidationError):
                validate_overrides({**legacy, 'undo': undo})

    def test_explicit_conflicts_and_invalid_bindings_still_fail(self):
        for value in [{'undo': ['KeyG']}, {'redo': ['Meta+Delete']}, {'undo': ['Ctrl+z']},
                      {'undo': ['Alt+KeyZ'], 'redo': ['Alt+KeyZ']}]:
            with self.assertRaises(ValidationError):
                validate_overrides(value)
