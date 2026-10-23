from django.conf import settings
from django.db import models


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
