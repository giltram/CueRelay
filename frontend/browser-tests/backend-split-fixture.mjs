// Browser fixtures use the real pure backend rule engine; HTTP authorization and
// transaction semantics are verified separately against PostgreSQL by Django.
import { execFileSync } from 'node:child_process';
export const emptyDocument = JSON.parse(execFileSync('../.venv/bin/python', ['-c',
  'import sys,json; sys.path.insert(0,"../backend"); from ass_format import empty_document; print(json.dumps(empty_document()))'], { encoding: 'utf8' }));
export function splitOnBackend(request) {
  return JSON.parse(execFileSync('../.venv/bin/python', ['-c', `
import sys,json
sys.path.insert(0,"../backend")
from ass_format import split_document, AssError
try:
    print(json.dumps({'status':200,'body':split_document(**json.load(sys.stdin))}))
except AssError as error:
    print(json.dumps({'status':422,'body':{'issues':[error.issue]}}))
`], { input: JSON.stringify(request), encoding: 'utf8' }));
}
