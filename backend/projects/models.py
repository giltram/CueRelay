from django.conf import settings
from django.db import models


class Project(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active'
        ARCHIVED = 'archived'

    organization = models.ForeignKey('organizations.Organization', on_delete=models.PROTECT, related_name='projects')
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=2000, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    media = models.JSONField()
    document = models.JSONField()
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+', null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(status__in=['active', 'archived']), name='valid_project_status'),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name='positive_project_revision'),
            models.CheckConstraint(condition=(
                models.Q(status='active', archived_at__isnull=True, archived_by__isnull=True) |
                models.Q(status='archived', archived_at__isnull=False, archived_by__isnull=False)
            ), name='consistent_project_archive'),
        ]
        indexes = [models.Index(fields=['organization', 'status', '-updated_at'], name='project_list_order')]
