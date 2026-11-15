import uuid
from django.conf import settings
from django.db import models


class Glossary(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.PROTECT, related_name='+')
    is_organization_default = models.BooleanField(default=False)
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')


    class Meta:
        constraints = [models.UniqueConstraint(fields=['organization'], condition=models.Q(is_organization_default=True),
                                               name='unique_organization_default_glossary')]


class Entry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    glossary = models.ForeignKey(Glossary, on_delete=models.PROTECT, related_name='entries')
    original = models.CharField(max_length=200)
    translation = models.CharField(max_length=200)
    note = models.CharField(max_length=2000, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['glossary', 'original', 'translation'], name='unique_glossary_entry'),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name='positive_glossary_entry_revision'),
        ]
        indexes = [models.Index(fields=['glossary', 'original', 'id'], name='glossary_entry_order')]
