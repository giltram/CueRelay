"""Browser test bridge to the real pure codec. No Django, authentication or database."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ass_format import (AssError, empty_document, parse_ass, serialize_ass, split_document,
                        apply_style_operation, import_style, style_usage)


def execute(action, data):
    if action == 'empty':
        return {'document': empty_document()}
    if action == 'parse':
        return {'document': parse_ass(data['source'])}
    if action == 'export':
        return {'text': serialize_ass(data['document'])}
    if action == 'split':
        return split_document(**data)
    if action == 'styles':
        document = data['document'] if data['operation'] == {'type': 'inspect'} else apply_style_operation(**data)
        return {'document': document, 'usage': style_usage(document)}
    if action == 'import':
        document = import_style(**data)
        return {'document': document, 'usage': style_usage(document)}
    if action == 'ui_fixture':
        document = empty_document()
        names = data.get('names', ['Default'])
        document = apply_style_operation(document, {'type': 'update', 'id': document['styles'][0]['id'], 'name': names[0], 'fields': {}})
        for name in names[1:]:
            document = apply_style_operation(document, {'type': 'copy', 'id': document['styles'][0]['id'], 'name': name, 'fields': {}})
        return {'document': document}
    raise ValueError('Unknown test action')


try:
    request = json.load(sys.stdin)
    print(json.dumps({'status': 200, 'body': execute(request['action'], request.get('data', {}))}))
except AssError as failure:
    print(json.dumps({'status': 422, 'body': {'issues': [failure.issue]}}))
