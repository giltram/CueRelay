"""Project browser fixtures; run only in a fresh disposable database."""
import os
import re
from django.conf import settings
from accounts.models import User
from organizations.services import create_organization, add_member

database = settings.DATABASES['default']['NAME']
if not (database == 'cuerelay_projects_browser' or re.fullmatch(r'cuerelay_navigation_browser_[0-9]+', database)) or not settings.DEBUG:
    raise RuntimeError('Requires DEBUG and a disposable project/navigation browser database')
if User.objects.exists():
    raise RuntimeError('Refusing to overwrite existing accounts')
password = os.environ['BROWSER_TEST_PASSWORD']
a = User.objects.create_user('project-organizer', password=password)
b = User.objects.create_user('project-member', password=password)
dev = User.objects.create_superuser('project-dev', password=password)
User.objects.create_user('project-empty', password=password)
org = create_organization('项目测试 A', a.pk)
other = create_organization('项目测试 B', b.pk)
add_member(dev, org.pk, b.username)
add_member(dev, other.pk, a.username)
create_organization('私有组织', dev.pk)
print('Project browser fixtures ready')
