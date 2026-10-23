from django.contrib.auth.models import AbstractUser
from django.db import models
from django.core.exceptions import ValidationError


class User(AbstractUser):
    display_name = models.CharField(max_length=80, blank=True)

    def delete(self, *args, **kwargs):
        raise ValidationError('账号不能删除，请通过站点管理停用。')


class PersonalSettings(models.Model):
    user = models.OneToOneField(User, primary_key=True, on_delete=models.PROTECT)
    shortcut_overrides = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
