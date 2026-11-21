"""Subtitle-only SRT conversion; anonymous, stateless and without database access."""
from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny

from ass_format import AssError
from srt_format import SrtError, parse_srt, serialize_srt
from message_contracts import localized
from .message_response import MessageResponse as Response


def _convert(request, field, conversion, download=False):
    try:
        request.body  # Enforce Django's JSON byte budget before DRF consumes the stream.
        data = request.data
        if not isinstance(data, dict) or set(data) != {field}:
            return Response({'issues': [{'code': 'invalid_request', 'message': localized(
                'srt.requestFields', '仅接受 {{field}} 字段。', {'field': field})}]}, status=400)
        result = conversion(data[field])
        if not download:
            return Response({'document': result})
        response = HttpResponse(result, content_type='text/plain; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="cuerelay.srt"'
        return response
    except (SrtError, AssError) as error:
        return Response({'issues': [error.issue]}, status=422)
    except RequestDataTooBig:
        return Response({'issues': [{'code': 'too_large', 'message': localized(
            'server.requestBodyIsTooLarge', '请求体过大', {})}]}, status=413)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def import_srt(request):
    return _convert(request, 'source', parse_srt)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def export_srt(request):
    return _convert(request, 'document', serialize_srt, download=True)
