"""ASS import/persistence/export/reimport without changing project save contracts."""
from copy import deepcopy
from django.test import TestCase
from accounts.models import User
from organizations.services import create_organization
from ass_format.test_compatibility import CORPUS, corpus_manifest, assert_document, assert_output
from .models import Project


class PersistedAssCompatibilityTests(TestCase):
    def setUp(self):
        actor = User.objects.create_user('ass-compatibility')
        organization = create_organization('ASS compatibility', actor.pk)
        self.client.force_login(actor)
        self.base = f'/api/organizations/{organization.pk}/projects'
        self.media = {'sha256': 'b' * 64, 'size': 100, 'duration_ms': 5000}

    def create(self, source, name):
        return self.client.post(self.base, {'source': source, 'name': name, 'description': '', 'media': self.media}, content_type='application/json')

    def test_corpus_survives_project_create_read_save_export_and_reimport(self):
        for filename, expected in corpus_manifest()['valid'].items():
            with self.subTest(filename=filename):
                source = (CORPUS / filename).read_text(encoding='utf-8')
                created = self.create(source, filename)
                self.assertEqual(created.status_code, 200)
                project = created.json()['project']
                url = f"{self.base}/{project['id']}"
                read = self.client.get(url).json()['project']
                self.assertEqual(read['document']['source'], source)
                assert_document(self, read['document'], expected)
                # Make a real saved edit, preserving original template and styles.
                edited = deepcopy(read['document'])
                if edited['cues']:
                    edited['cues'][0]['text'] = '持久化修改,\\N保真'
                response = self.client.put(url + '/document', {'revision': read['revision'], 'document': edited}, content_type='application/json')
                self.assertEqual(response.status_code, 200)
                persisted = self.client.get(url).json()['project']
                self.assertEqual(persisted['document'], edited)
                self.assertEqual(persisted['revision'], 2 if edited['cues'] else 1)
                exported = self.client.post('/api/ass/export', {'document': persisted['document']}, content_type='application/json')
                self.assertEqual(exported.status_code, 200)
                output = exported.content.decode('utf-8')
                updated_expected = deepcopy(expected)
                if edited['cues']:
                    updated_expected['cues'][0]['text'] = '持久化修改,\\N保真'
                    kind, payload = updated_expected['events'][0].split(': ', 1)
                    updated_expected['events'][0] = kind + ': ' + ','.join(payload.split(',', 9)[:9]) + ',持久化修改,\\N保真'
                assert_output(self, output, updated_expected)
                reimported = self.create(output, 'reimport ' + filename)
                self.assertEqual(reimported.status_code, 200)
                assert_document(self, reimported.json()['project']['document'], updated_expected)

    def test_invalid_corpus_does_not_create_partial_projects(self):
        for filename in corpus_manifest()['invalid']:
            with self.subTest(filename=filename):
                before = Project.objects.count()
                response = self.create((CORPUS / filename).read_text(encoding='utf-8'), filename)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(Project.objects.count(), before)
