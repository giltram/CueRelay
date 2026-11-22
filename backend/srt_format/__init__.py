"""Stateless SRT boundary. Depends only on stdlib, ass_format and message_contracts."""
from .codec import parse_srt, serialize_srt
from .errors import SrtError

from .reference import parse_reference_srt

__all__ = ['parse_srt', 'serialize_srt', 'SrtError', 'parse_reference_srt']
