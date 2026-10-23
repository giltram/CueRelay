"""Run via manage.py shell on a fresh, disposable user browser database only."""
import os
import re
from django.conf import settings
from accounts.models import User
from organizations.services import create_organization, add_member

database = settings.DATABASES['default']['NAME']
if not (database == 'cuerelay_browser' or re.fullmatch(r'cuerelay_users_browser_[0-9]+', database)) or not settings.DEBUG:
    raise RuntimeError('Browser fixtures require DEBUG and a disposable user browser database')
if User.objects.exists():
    raise RuntimeError('Refusing to seed an existing user database')
password = os.environ['BROWSER_TEST_PASSWORD']
alice = User.objects.create_user('browser-alice', password=password)
bob = User.objects.create_user('browser-bob', password=password)
dev = User.objects.create_superuser('browser-dev', password=password)
User.objects.create_user('browser-empty', password=password)
a = create_organization('浏览器组织 A', alice.pk)
b = create_organization('浏览器组织 B', bob.pk)
add_member(dev, a.pk, bob.username)
add_member(dev, b.pk, alice.username)
create_organization('私有组织', dev.pk)
print('Disposable browser fixtures ready')
