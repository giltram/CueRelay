"""Check real Playwright discovery without starting servers, browsers or a database."""
import ast
from collections import Counter
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RegressionSelectionTests(unittest.TestCase):
    def list_scenarios(self, selector=None):
        command = ['node', 'node_modules/playwright/cli.js', 'test',
                   '--config', 'regression/playwright.config.mjs', '--list', '--reporter=json',
                   '--pass-with-no-tests']
        if selector is not None:
            command.extend(['--grep', selector])
        result = subprocess.run(command, cwd=ROOT / 'frontend', env={**os.environ,
            # Discovery only: --list never starts the configured web server.
            'CUERELAY_API_TARGET': 'http://127.0.0.1:1',
            'CUERELAY_REGRESSION_FIXTURES': '{}',
        }, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report['errors'], [])
        scenarios = []
        suites = list(report['suites'])
        while suites:
            suite = suites.pop()
            suites.extend(suite.get('suites', []))
            for spec in suite.get('specs', []):
                scenarios.extend(spec['id'] for _ in spec['tests'])
        return scenarios

    def test_django_entries_select_every_playwright_scenario_exactly_once(self):
        # Read selectors without importing Django or executing database fixture setup.
        module = ast.parse((ROOT / 'backend/browser_tests/regression.py').read_text())
        regression = next(node for node in module.body
                          if isinstance(node, ast.ClassDef) and node.name == 'WorkspaceRegressionTests')
        entries = [node for node in regression.body
                   if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')]
        self.assertTrue(entries)
        available = self.list_scenarios()
        self.assertTrue(available)
        selected = []
        for entry in entries:
            with self.subTest(entry=entry.name):
                calls = [node for node in ast.walk(entry)
                         if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                         and isinstance(node.func.value, ast.Name) and node.func.value.id == 'self'
                         and node.func.attr == 'run_browser']
                self.assertEqual(len(calls), 1, 'Each Django entry must select one scenario explicitly')
                selector = ast.literal_eval(calls[0].args[0])
                self.assertIsInstance(selector, str)
                matches = self.list_scenarios(selector)
                selected.extend(matches)
                self.assertEqual(len(matches), 1, f'{selector!r} must select exactly one scenario')
        self.assertEqual(Counter(selected), Counter(available),
                         'Django entries must cover the discovered scenarios without omissions or duplicates')


if __name__ == '__main__':
    unittest.main()
