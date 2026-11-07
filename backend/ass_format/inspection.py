"""Read-only inspection using the exporter's exact validators, never repaired copies."""
from .codec import _document_layout, _cue_record, serialize_ass
from .errors import AssError


def inspect_document(document):
    """Return first fatal issue per row, or a document-level export failure.

    The complete serializer also checks source metadata, styles and output limits.
    A successful inspection guarantees this exact snapshot can be serialized.
    """
    try:
        layout, by_id, _, cues = _document_layout(document)
    except AssError as error:
        return [{**error.issue, 'type': 'unsupported-ass'}]
    issues, seen = [], set()
    for cue in cues:
        try:
            _cue_record(cue, layout, by_id, seen)
        except AssError as error:
            issue = {**error.issue, 'type': error.category}
            if isinstance(cue, dict) and isinstance(cue.get('id'), str):
                issue['cue_id'] = cue['id']
            issues.append(issue)
    if issues:
        return issues
    try:
        serialize_ass(document)
    except AssError as error:
        return [{**error.issue, 'type': 'unsupported-ass'}]
    return []
