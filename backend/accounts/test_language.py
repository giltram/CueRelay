"""Language settings reuse account ownership and partial-update atomicity."""
from django.core.exceptions import ValidationError
from django.test import TestCase
from .models import User, PersonalSettings
from .services import settings_for, save_settings


class LanguagePreferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('language-one')
        self.other = User.objects.create_user('language-two')

    def test_default_is_system_and_read_does_not_create_settings(self):
        self.assertEqual(settings_for(self.user)['language_preference'], 'system')
        self.assertFalse(PersonalSettings.objects.exists())

    def test_partial_updates_preserve_other_settings_and_accounts(self):
        save_settings(self.user, {'audio_display_mode': 'waveform', 'mouse_sets_cue_boundary': False})
        for preference in ['en', 'zh-CN', 'system']:
            result = save_settings(self.user, {'language_preference': preference})
            self.assertEqual(result['language_preference'], preference)
            self.assertEqual(result['audio_display_mode'], 'waveform')
            self.assertFalse(result['mouse_sets_cue_boundary'])
            self.assertEqual(settings_for(self.other)['language_preference'], 'system')
        save_settings(self.user, {'language_preference': 'en'})
        self.assertEqual(save_settings(self.user, {'shortcut_overrides': {}})['language_preference'], 'en')

    def test_invalid_and_test_only_preferences_reject_the_whole_update(self):
        save_settings(self.user, {'language_preference': 'en'})
        for value in ['en-XA', 'fr', '', None, [], True]:
            with self.assertRaises(ValidationError):
                save_settings(self.user, {'language_preference': value, 'audio_display_mode': 'waveform'})
            result = settings_for(self.user)
            self.assertEqual(result['language_preference'], 'en')
            self.assertEqual(result['audio_display_mode'], 'spectrum')
