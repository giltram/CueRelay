from django.conf import settings
from django.db import models
from uuid import uuid4


class Organization(models.Model):
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class OrganizationMembership(models.Model):
    class Role(models.TextChoices):
        ORGANIZER = 'organizer'
        MEMBER = 'member'

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='memberships')
    role = models.CharField(max_length=9, choices=Role.choices)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organization', 'user'], name='unique_organization_user'),
            models.CheckConstraint(condition=models.Q(role__in=['organizer', 'member']), name='valid_organization_role'),
        ]


class OrganizationStyleTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name='style_templates')
    name = models.CharField(max_length=100)
    fields = models.JSONField()
    reference = models.JSONField()
    source_label = models.CharField(max_length=500, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organization', 'name'], name='unique_org_style_name'),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name='positive_template_revision'),
        ]
