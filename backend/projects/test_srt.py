"""SRT initialization and export preserve the existing project/revision contract."""
from copy import deepcopy
from django.test import TestCase

from accounts.models import User
from organizations.services import create_organization
from ass_format import empty_document, serialize_ass, parse_ass
from srt_format import parse_srt, serialize_srt


class ProjectSrtTests(TestCase):
    def setUp(self):
        actor = User.objects.create_user('srt-project')
        organization = create_organization('SRT test', actor.pk)
        self.client.force_login(actor)
        self.url = f'/api/organizations/{organization.pk}/projects'
        self.media = {'sha256': 'b' * 64, 'size': 100, 'duration_ms': 5000}

    def test_initialize_save_export_read_and_source_replacement_is_still_forbidden(self):
        converted = parse_srt('8\n00:00:01,234 --> 00:00:02,345\n<b>中文</b>\n😀')
        response = self.client.post(self.url, {'name': 'SRT', 'description': '', 'media': self.media,
                                             'source': converted['source']}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        project = response.json()['project']
        url = self.url + '/' + str(project['id'])
        document = deepcopy(project['document'])
        self.assertEqual(document['script'], empty_document()['script'])
        self.assertEqual(document['styles'][0]['fields'], empty_document()['styles'][0]['fields'])
        before = deepcopy(document)
        document['cues'][0]['text'] += ' 未保存'
        export = self.client.post('/api/srt/export', {'document': document}, content_type='application/json')
        self.assertEqual(export.status_code, 200)
        self.assertIn('未保存', export.content.decode())
        self.assertEqual(self.client.get(url).json()['project'], project)
        saved = self.client.put(url + '/document', {'revision': project['revision'], 'document': document}, content_type='application/json')
        self.assertEqual(saved.status_code, 200)
        persisted = self.client.get(url).json()['project']
        self.assertEqual(persisted['revision'], project['revision'] + 1)
        self.assertEqual(persisted['document'], document)
        self.assertEqual(serialize_srt(persisted['document']), export.content.decode())
        self.assertEqual(parse_ass(serialize_ass(document))['cues'][0]['text'], document['cues'][0]['text'])
        replaced = deepcopy(document)
        replaced['source'] = parse_srt('1\n00:00:00,000 --> 00:00:01,000\nreplacement')['source']
        response = self.client.put(url + '/document', {'revision': persisted['revision'], 'document': replaced}, content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(url).json()['project'], persisted)
        self.assertEqual(before['styles'], persisted['document']['styles'])
