"""Stateless JSON conversion endpoints. Only subtitle text enters this boundary."""
from django.http import HttpResponse
from django.core.exceptions import RequestDataTooBig
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from ass_format import AssError, empty_document as make_empty, parse_ass, serialize_ass, split_document, apply_style_operation, style_usage


def _payload(request):
    # JSONParser reads the stream directly; read body first so Django enforces
    # DATA_UPLOAD_MAX_MEMORY_SIZE before decoding untrusted JSON.
    request.body
    return request.data


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def empty_document(request):
    return Response({"document": make_empty()})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def import_ass(request):
    try:
        data = _payload(request)
        if not isinstance(data, dict) or set(data) != {"source"}:
            return Response({"issues": [{"code": "invalid_request", "message": "仅接受 source 字段"}]}, status=400)
        return Response({"document": parse_ass(data["source"])})
    except AssError as error:
        return Response({"issues": [error.issue]}, status=422)
    except RequestDataTooBig:
        return Response({"issues": [{"code": "too_large", "message": "请求体过大"}]}, status=413)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def export_ass(request):
    try:
        data = _payload(request)
        if not isinstance(data, dict) or set(data) != {"document"}:
            return Response({"issues": [{"code": "invalid_request", "message": "仅接受 document 字段"}]}, status=400)
        result = serialize_ass(data["document"])
        response = HttpResponse(result, content_type="text/plain; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="cuerelay.ass"'
        return response
    except AssError as error:
        return Response({"issues": [error.issue]}, status=422)
    except RequestDataTooBig:
        return Response({"issues": [{"code": "too_large", "message": "请求体过大"}]}, status=413)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def split_ass(request):
    """Stateless local-workspace transform; does not read or write projects."""
    try:
        data = _payload(request)
        if not isinstance(data, dict) or set(data) != {"document", "cue_id", "mode", "position"}:
            return Response({"issues": [{"code": "invalid_request", "message": "拆分请求字段不符合契约"}]}, status=400)
        return Response(split_document(**data))
    except AssError as error:
        return Response({"issues": [error.issue]}, status=422)
    except RequestDataTooBig:
        return Response({"issues": [{"code": "too_large", "message": "请求体过大"}]}, status=413)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def local_styles(request):
    """Pure style transform/inspection; never reads session, organizations or projects."""
    try:
        data = _payload(request)
        if not isinstance(data, dict) or set(data) != {"document", "operation"}:
            return Response({"issues": [{"code": "invalid_request", "message": "样式请求字段不符合契约"}]}, status=400)
        document = data['document'] if data['operation'] == {'type': 'inspect'} else apply_style_operation(**data)
        return Response({'document': document, 'usage': style_usage(document)})
    except AssError as error:
        return Response({"issues": [error.issue]}, status=422)
    except RequestDataTooBig:
        return Response({"issues": [{"code": "too_large", "message": "请求体过大"}]}, status=413)
