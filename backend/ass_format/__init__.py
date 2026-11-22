"""Pure ASS conversion boundary; no Django, storage or network dependencies."""

from .splitting import split_document
from .codec import AssError, MAX_BYTES, MAX_CUES, MAX_TIME, empty_document, parse_ass, serialize_ass
from .style_operations import apply_style_operation, import_style, import_style_snapshots, style_usage
from .styles import validate_fields, validate_id, validate_name, validate_script, adapt_fields
from .clipboard import copy_lines, paste_lines
from .inspection import inspect_document
from .text import text_tokens

__all__ = ["text_tokens", "AssError", "MAX_BYTES", "MAX_CUES", "MAX_TIME", "empty_document", "parse_ass", "serialize_ass", "inspect_document", "split_document", "copy_lines", "paste_lines",
           "apply_style_operation", "import_style", "import_style_snapshots", "style_usage", "validate_fields", "validate_id", "validate_name", "validate_script", "adapt_fields"]
