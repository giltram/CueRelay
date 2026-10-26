from pathlib import Path
from django.test import SimpleTestCase, override_settings

FIXTURES = Path(__file__).resolve().parent.parent / "ass_format" / "fixtures"


class ConversionContractTests(SimpleTestCase):
    def test_extreme_style_numbers_return_422_on_import_and_style_transform(self):
        from ass_format import empty_document
        document = empty_document()
        for value in ['1e1000000', '-1e1000000', '1e99999999999999999999', 'NaN', 'sNaN', 'Infinity',
                      '10000.00000000000000000000000000001']:
            with self.subTest(value=value):
                source = document['source'].replace(',28,', f',{value},')
                imported = self.client.post('/api/ass/import', {'source': source}, content_type='application/json')
                transformed = self.client.post('/api/ass/styles', {'document': document, 'operation': {
                    'type': 'update', 'id': document['styles'][0]['id'], 'name': 'Default',
                    'fields': {'Fontsize': value}}}, content_type='application/json')
                for response in (imported, transformed):
                    self.assertEqual(response.status_code, 422)
                    self.assertIn('Fontsize', response.json()['issues'][0]['message'])

    def test_supported_ass_larger_than_one_megabyte_as_json_roundtrips(self):
        import json
        from ass_format import empty_document
        source = empty_document()['source'] + (
            'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0000,0000,0000,,' + 'a' * 1000 + '\n') * 600
        self.assertLess(len(source.encode()), 1024 * 1024)
        imported = self.client.post('/api/ass/import', {'source': source}, content_type='application/json')
        self.assertEqual(imported.status_code, 200)
        body = json.dumps(imported.json(), ensure_ascii=False, separators=(',', ':')).encode()
        self.assertGreater(len(body), 1024 * 1024)
        self.assertLess(len(body), 3 * 1024 * 1024)
        exported = self.client.post('/api/ass/export', body, content_type='application/json')
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported.content.decode(), source)

    def test_default_three_megabyte_request_budget_still_rejects_oversized_json(self):
        response = self.client.post('/api/ass/import', {'source': 'a' * (3 * 1024 * 1024)}, content_type='application/json')
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['issues'][0]['code'], 'too_large')

    def test_styles_endpoint_is_stateless_csrf_independent_and_validates_schema(self):
        from django.test import Client
        client = Client(enforce_csrf_checks=True)
        document = client.get('/api/ass/empty').json()['document']
        response = client.post('/api/ass/styles', {'document': document, 'operation': {
            'type': 'copy', 'id': document['styles'][0]['id'], 'name': 'Actor', 'fields': {'Fontsize': '55'}}}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['document']['styles']), 2)
        self.assertEqual(client.post('/api/ass/styles', {}, content_type='application/json').status_code, 400)
        self.assertEqual(client.post('/api/ass/styles', {'document': document, 'operation': {'type': 'import'}}, content_type='application/json').status_code, 422)
        self.assertEqual(client.post('/api/ass/styles', {'document': {'source': '', 'styles': [], 'cues': []}, 'operation': {'type': 'inspect'}}, content_type='application/json').status_code, 422)
        self.assertEqual(client.get('/api/ass/styles').status_code, 405)

    def test_empty_import_export_and_edit_contract(self):
        empty = self.client.get("/api/ass/empty")
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json()["document"]["cues"], [])
        source = (FIXTURES / "basic.ass").read_text()
        response = self.client.post("/api/ass/import", {"source": source}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        document = response.json()["document"]
        document["cues"][0].update(text="接口修改中文\\N第二行", end_ms=3500)
        exported = self.client.post("/api/ass/export", {"document": document}, content_type="application/json")
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported["Content-Type"], "text/plain; charset=utf-8")
        self.assertIn("attachment", exported["Content-Disposition"])
        roundtrip = self.client.post("/api/ass/import", {"source": exported.content.decode("utf-8")}, content_type="application/json")
        self.assertEqual(roundtrip.json()["document"]["cues"][0]["text"], "接口修改中文\\N第二行")
        self.assertEqual(roundtrip.json()["document"]["cues"][0]["end_ms"], 3500)

    def test_explicit_rejection_and_contract_validation(self):
        response = self.client.post("/api/ass/import", {"source": (FIXTURES / "unsupported.ass").read_text()}, content_type="application/json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["issues"][0]["line"], 8)
        self.assertNotIn("document", response.json())
        for endpoint, body in [("import", {}), ("export", {"cues": []}), ("import", {"source": "", "video": "not permitted"}), ("import", [])]:
            with self.subTest(endpoint=endpoint, body=body):
                result = self.client.post(f"/api/ass/{endpoint}", body, content_type="application/json")
                self.assertEqual(result.status_code, 400)
        invalid = self.client.post("/api/ass/import", {"source": 5}, content_type="application/json")
        self.assertEqual(invalid.status_code, 422)

    def test_invalid_export_time_and_text_are_rejected(self):
        document = self.client.get("/api/ass/empty").json()["document"]
        document["cues"] = [{"id": "new-test", "start_ms": 0, "end_ms": 0, "text": "零长度", "style_id": document["styles"][0]["id"]}]
        result = self.client.post("/api/ass/export", {"document": document}, content_type="application/json")
        self.assertEqual(result.status_code, 422)
        document["cues"][0].update(end_ms=100, text=r"{\pos(1,2)}不支持")
        result = self.client.post("/api/ass/export", {"document": document}, content_type="application/json")
        self.assertEqual(result.status_code, 422)

    def test_stateless_split_endpoint_validation_and_roundtrip(self):
        from ass_format import empty_document
        document = empty_document()
        document['cues'] = [{'id': 'new-test', 'start_ms': 1000, 'end_ms': 4000, 'text': '甲乙', 'style_id': document['styles'][0]['id']}]
        body = {'document': document, 'cue_id': 'new-test', 'mode': 'text', 'position': 1}
        response = self.client.post('/api/ass/split', body, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual([cue['text'] for cue in result['document']['cues']], ['甲', '乙'])
        self.assertEqual(self.client.post('/api/ass/export', {'document': result['document']}, content_type='application/json').status_code, 200)
        for invalid in [{}, {**body, 'project_id': 1}]:
            self.assertEqual(self.client.post('/api/ass/split', invalid, content_type='application/json').status_code, 400)
        for invalid in [{**body, 'position': 0}, {**body, 'mode': 'playhead', 'position': 2000}]:
            self.assertEqual(self.client.post('/api/ass/split', invalid, content_type='application/json').status_code, 422)
        self.assertEqual(self.client.get('/api/ass/split').status_code, 405)

    def test_methods_and_content_types(self):
        self.assertEqual(self.client.get("/api/ass/import").status_code, 405)
        self.assertEqual(self.client.post("/api/ass/import", "video bytes", content_type="video/mp4").status_code, 415)
        self.assertEqual(self.client.post("/api/ass/import", "{", content_type="application/json").status_code, 400)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=64)
    def test_json_body_limit_is_enforced_before_json_parser(self):
        for endpoint, payload in [("import", {"source": "x" * 100}), ("export", {"document": {"source": "x" * 100}}), ("split", {"document": {"source": "x" * 100}}), ("styles", {"document": {"source": "x" * 100}})]:
            result = self.client.post(f"/api/ass/{endpoint}", payload, content_type="application/json")
            self.assertEqual(result.status_code, 413)
