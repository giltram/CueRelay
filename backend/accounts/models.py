from django.contrib.auth.models import AbstractUser
from django.db import models
from django.core.exceptions import ValidationError


class User(AbstractUser):
    def delete(self, *args, **kwargs):
        raise ValidationError('账号不能删除，请通过站点管理停用。')


class AudioDisplayMode(models.TextChoices):
    WAVEFORM = 'waveform', 'Waveform'
    SPECTRUM = 'spectrum', 'Spectrum'


class PersonalSettings(models.Model):
    user = models.OneToOneField(User, primary_key=True, on_delete=models.PROTECT)
    shortcut_overrides = models.JSONField(default=dict)
    audio_display_mode = models.CharField(max_length=8, choices=AudioDisplayMode, default=AudioDisplayMode.SPECTRUM)
    mouse_sets_cue_boundary = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(audio_display_mode__in=AudioDisplayMode.values), name='accounts_valid_audio_display_mode')]


class LoginAttempt(models.Model):
    # Exists for unknown usernames too; never store passwords or raw credentials.
    account_key = models.CharField(max_length=64, primary_key=True)
    failure_times = models.JSONField(default=list)
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
