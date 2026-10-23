"""Run via manage.py shell on a fresh, disposable cuerelay_browser database only."""
import os
from django.conf import settings
from accounts.models import User
from organizations.services import create_organization, add_member

if settings.DATABASES['default']['NAME'] != 'cuerelay_browser' or not settings.DEBUG:
    raise RuntimeError('Browser fixtures require DEBUG and disposable cuerelay_browser database')
if User.objects.exists():
    raise RuntimeError('Refusing to seed an existing user database')
password = os.environ['BROWSER_TEST_PASSWORD']
alice = User.objects.create_user('browser-alice', password=password, display_name='测试甲')
bob = User.objects.create_user('browser-bob', password=password, display_name='测试乙')
dev = User.objects.create_superuser('browser-dev', password=password)
User.objects.create_user('browser-empty', password=password)
a = create_organization('浏览器组织 A', alice.pk)
b = create_organization('浏览器组织 B', bob.pk)
add_member(dev, a.pk, bob.username)
add_member(dev, b.pk, alice.username)
create_organization('私有组织', dev.pk)
print('Disposable browser fixtures ready')
