"""Presentation metadata on stateless conversion responses, including QC issues."""
from rest_framework.response import Response
from message_contracts import wire_messages


class MessageResponse(Response):
    def __init__(self, data=None, **kwargs):
        super().__init__(wire_messages(data), **kwargs)
