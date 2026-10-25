"""Editable ASS v4+ subset with a raw-line preservation adapter.

Public DTO v2: structured styles/script and cue.style_id. source is a template,
not a storage key. Every conversion re-preflights it. Original Dialogue IDs
identify raw line anchors; new IDs append events without reordering comments.
pysubs2 parses canonical mapped records; it never serializes the source file.
"""

import re
import warnings
from dataclasses import dataclass
from uuid import uuid4
from .errors import AssError, fail as _fail
from .styles import STYLE_FIELDS, MAX_STYLES, validate_values as _style, validate_script, validate_styles

import pysubs2

MAX_BYTES = 1024 * 1024
MAX_CUES = 5000
MAX_TIME = 35_999_990  # ASS workbench supports 0:00:00.00 through 9:59:59.99.
EVENT_FIELDS = "Layer Start End Style Name MarginL MarginR MarginV Effect Text".split()
TIME = re.compile(r"([0-9]):([0-5][0-9]):([0-5][0-9])\.([0-9]{2})")
TAG_BLOCK = re.compile(r"(?:\\[bius][01])+")


def _text(value, line=None):
    if not isinstance(value, str) or len(value) > 16_384:
        _fail("字幕文本须为不超过 16384 字符的字符串", line)
    cursor = 0
    while cursor < len(value):
        char = value[cursor]
        if ord(char) < 32 or char in "\u0085\u2028\u2029":
            _fail(r"字幕不能包含控制字符；换行请使用 \N", line)
        if char == "{":
            end = value.find("}", cursor)
            if end < 0 or not TAG_BLOCK.fullmatch(value[cursor + 1:end]):
                _fail(r"仅支持 \b0/1、\i0/1、\u0/1、\s0/1 标签；其他标签或花括号须保护性拒绝", line)
            cursor = end + 1
        elif char == "}":
            _fail("ASS 花括号未配对", line)
        elif char == "\\":
            if cursor + 1 >= len(value) or value[cursor + 1] not in "Nnh":
                _fail(r"文本仅支持 \N、\n、\h 转义", line)
            cursor += 2
        else:
            cursor += 1


def _time(value, line):
    match = TIME.fullmatch(value.strip())
    if not match:
        _fail("时间须使用 h:mm:ss.cc（0–9 小时）", line)
    # Delegate conversion only after rejecting the library's permissive syntax.
    return pysubs2.time.timestamp_to_ms(match.groups())


def _interval(start, end, line=None):
    if any(type(t) is not int or t < 0 or t > MAX_TIME or t % 10 for t in (start, end)):
        _fail("时间须为 0–35999990 的整数毫秒，并对齐 10ms", line)
    if start >= end:
        _fail("入点必须早于出点，不能创建零长度字幕", line)


def _format_time(ms):
    hours, rest = divmod(ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, rest = divmod(rest, 1000)
    return f"{hours}:{minutes:02}:{seconds:02}.{rest // 10:02}"


def _fields(value, expected, line):
    fields = [part.strip() for part in value.split(",")]
    if len(fields) != len(expected) or set(fields) != set(expected):
        _fail("Format 包含缺失、重复或不支持的字段", line)
    if "Text" in expected and fields[-1] != "Text":
        _fail("当前要求 Text 是 Events 的最后一个字段", line)
    return fields


@dataclass
class _Layout:
    lines: list[str]
    records: dict[str, tuple[int, list[str], list[str]]]
    event_format: list[str]
    insertion: int
    style_format: list[str]
    style_records: dict
    style_insertion: int
    comments: dict
    script_records: dict
    script_insertion: int
    script: dict


def _inspect(source):
    if not isinstance(source, str):
        _fail("source 须为 UTF-8 ASS 文本")
    try:
        if len(source.encode("utf-8")) > MAX_BYTES:
            _fail("ASS 文本不能超过 1MiB")
    except UnicodeError:
        _fail("ASS 包含非法 Unicode")
    if any((ord(char) < 32 and char not in "\t\r\n") or char in "\u0085\u2028\u2029" for char in source):
        _fail("ASS 包含不支持的控制字符或非标准换行")
    lines = source.removeprefix("\ufeff").splitlines()
    section = None
    seen = set()
    style_format = event_format = None
    styles, cues, records, canonical_events, canonical_styles = [], [], {}, [], []
    script_type = None
    insertion = len(lines)
    style_insertion = script_insertion = len(lines)
    style_records, comments, script_records = {}, {}, {}
    script = {"play_res_x": None, "play_res_y": None, "scaled_border_and_shadow": None}
    for index, raw in enumerate(lines):
        line = index + 1
        stripped = raw.strip()
        if not stripped or stripped.startswith(";"):
            continue
        if stripped.startswith("["):
            if section == "[V4+ Styles]":
                style_insertion = index
            if section == "[Script Info]":
                script_insertion = index
            if section == "[Events]":
                insertion = index
            if stripped not in {"[Script Info]", "[V4+ Styles]", "[Events]", "[Aegisub Project Garbage]"} or stripped in seen:
                _fail("不支持或重复的 section；附件、SSA 和未知 section 不可编辑导入", line)
            seen.add(stripped)
            section = stripped
            continue
        if ":" not in raw:
            _fail("无法识别的 ASS 记录", line)
        key, value = raw.lstrip().split(":", 1)
        value = value.removeprefix(" ")
        if section in {"[Script Info]", "[Aegisub Project Garbage]"}:
            if section == "[Script Info]" and key == "ScriptType":
                if script_type is not None:
                    _fail("ScriptType 重复", line)
                script_type = value.strip()
            script_keys = {"PlayResX": "play_res_x", "PlayResY": "play_res_y", "ScaledBorderAndShadow": "scaled_border_and_shadow"}
            script_key = next((known for known in script_keys if known.casefold() == key.strip().casefold()), None)
            if section == "[Script Info]" and script_key:
                if script_key in script_records:
                    _fail(f"{script_key} 重复，不能安全编辑脚本设置", line)
                script_records[script_key] = index
                raw = value.strip()
                if script_key == "ScaledBorderAndShadow":
                    if raw.lower() not in ("yes", "no"):
                        _fail("ScaledBorderAndShadow 须为 yes/no", line)
                    script[script_keys[script_key]] = raw.lower() == "yes"
                else:
                    if not re.fullmatch(r"[1-9][0-9]{0,4}", raw) or int(raw) > 32768:
                        _fail("PlayRes 须为 1–32768 的整数", line)
                    script[script_keys[script_key]] = int(raw)
            continue  # Other metadata is preserved verbatim and never dereferenced.
        if section == "[V4+ Styles]":
            if key == "Format" and style_format is None:
                style_format = _fields(value, STYLE_FIELDS, line)
            elif key == "Style" and style_format:
                parts = value.split(",")
                if len(parts) != len(STYLE_FIELDS):
                    _fail("Style 字段数错误", line)
                values = dict(zip(style_format, (p.strip() for p in parts)))
                _style(values, line)
                if values["Name"] in styles:
                    _fail("样式名重复", line)
                styles.append(values["Name"])
                style_records[values["Name"]] = (index, style_format, values)
                canonical_styles.append("Style: " + ",".join(values[f] for f in STYLE_FIELDS))
            else:
                _fail("无法识别的样式记录或重复 Format", line)
        elif section == "[Events]":
            if key == "Format" and event_format is None:
                event_format = _fields(value, EVENT_FIELDS, line)
            elif key in {"Dialogue", "Comment"} and event_format:
                parts = value.split(",", len(event_format) - 1)
                if len(parts) != len(EVENT_FIELDS):
                    _fail("事件字段数错误", line)
                values = dict(zip(event_format, parts))
                if any(not re.fullmatch(r"[0-9]{1,5}", values[f].strip()) for f in ("Layer", "MarginL", "MarginR", "MarginV")):
                    _fail("事件 Layer/Margin 须为非负整数", line)
                if values["Effect"].strip():
                    _fail("非空 Effect 不支持可编辑导入", line)
                start, end = _time(values["Start"], line), _time(values["End"], line)
                _interval(start, end, line)
                _text(values["Text"], line)
                style = values["Style"].strip()
                canonical_events.append(key + ": " + ",".join(values[f] for f in EVENT_FIELDS))
                # Comment is validated but never exposed as an editable cue.
                if key == "Comment":
                    comments[index] = (event_format, values)
                if key == "Dialogue":
                    cue_id = f"source-{index}"
                    records[cue_id] = (index, event_format, parts)
                    cues.append({"id": cue_id, "start_ms": start, "end_ms": end, "text": values["Text"], "style": style})
            else:
                _fail("无法识别的事件记录或重复 Format", line)
        else:
            _fail("记录不属于受支持的 section", line)
    if script_type != "v4.00+" or not styles or event_format is None:
        _fail("需要 ASS v4.00+、至少一个样式及 Events Format")
    if len(canonical_events) > MAX_CUES:
        _fail("验证台最多接受 5000 个事件")
    if len(styles) > MAX_STYLES:
        _fail(f"文档最多接受 {MAX_STYLES} 个样式")
    # pysubs2 ignores Format lines, so feed it records already mapped by Format.
    canonical = "[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\n" + "\n".join(canonical_styles) + "\n[Events]\n" + "\n".join(canonical_events)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            parsed = pysubs2.SSAFile.from_string(canonical, format_="ass")
    except (ValueError, TypeError, RuntimeWarning) as error:
        raise AssError("ASS 字段无法安全解析") from error
    if any(event.style not in styles for event in parsed.events):
        _fail("事件引用了不存在的样式")
    validate_script(script, allow_partial=True)
    return {"source": source, "styles": styles, "cues": cues}, _Layout(
        lines, records, event_format, insertion, style_format, style_records,
        style_insertion, comments, script_records, script_insertion, script)


def parse_ass(source):
    """Preflight all records, returning an editable DTO or one explicit issue."""
    original, layout = _inspect(source)
    styles = [{"id": str(uuid4()), "name": name, "fields": {key: value for key, value in values.items() if key != "Name"},
               "source_name": name, "origin": None} for name, (_, _, values) in layout.style_records.items()]
    names = {style["name"]: style["id"] for style in styles}
    cues = [{**{key: value for key, value in cue.items() if key != "style"}, "style_id": names[cue["style"]]} for cue in original["cues"]]
    return {"schema_version": 2, "source": source, "script": layout.script, "styles": styles, "cues": cues}


def serialize_ass(document):
    """Validate a complete in-memory snapshot; preserve raw non-editable records."""
    if (not isinstance(document, dict) or set(document) != {"schema_version", "source", "script", "styles", "cues"}
            or type(document.get("schema_version")) is not int or document["schema_version"] != 2):
        _fail("文档契约已升级为 v2；请先导出旧页面稿件，再刷新客户端")
    original, layout = _inspect(document["source"])
    validate_script(document["script"], allow_partial=True)
    validate_styles(document["styles"], set(original["styles"]))
    by_id = {style["id"]: style for style in document["styles"]}
    by_source = {style["source_name"]: style for style in document["styles"] if style["source_name"] is not None}
    cues = document["cues"]
    if not isinstance(cues, list) or len(cues) > MAX_CUES:
        _fail("cues 须为不超过 5000 行的数组")
    replacements, additions, seen = {}, [], set()
    for cue in cues:
        required = {"id", "start_ms", "end_ms", "text", "style_id"}
        if not isinstance(cue, dict) or not required <= set(cue) or set(cue) - required - {"source_id"}:
            _fail("字幕行字段不符合契约")
        cue_id = cue["id"]
        if not isinstance(cue_id, str) or not cue_id or len(cue_id) > 100 or cue_id in seen:
            _fail("字幕 ID 须唯一且不超过 100 字符")
        seen.add(cue_id)
        _interval(cue["start_ms"], cue["end_ms"])
        _text(cue["text"])
        if not isinstance(cue["style_id"], str) or cue["style_id"] not in by_id:
            _fail("字幕引用了不存在的样式")
        source_id = cue.get("source_id", cue_id)
        if "source_id" in cue and (not cue_id.startswith("new-") or not isinstance(source_id, str) or source_id not in layout.records):
            _fail("拆分字幕的 source_id 必须引用模板中的原始字幕")
        if cue_id in layout.records:
            index, fields, raw_parts = layout.records[cue_id]
            values = dict(zip(fields, raw_parts))
        elif cue_id.startswith("new-"):
            index, fields = None, layout.event_format
            if "source_id" in cue:
                _, source_fields, source_parts = layout.records[source_id]
                values = dict(zip(source_fields, source_parts))
            else:
                values = dict(zip(EVENT_FIELDS, ["0", "", "", "", "", "0000", "0000", "0000", "", ""]))
        else:
            _fail("原始字幕 ID 无效；新行 ID 必须以 new- 开头")
        values.update(Start=_format_time(cue["start_ms"]), End=_format_time(cue["end_ms"]), Text=cue["text"], Style=by_id[cue["style_id"]]["name"])
        record = "Dialogue: " + ",".join(values[f] for f in fields)
        if index is None:
            additions.append(record)
        else:
            replacements[index] = record
    dialogue_lines = {record[0] for record in layout.records.values()}
    # Overlay styles/script without reparsing exported text, which would shift cue anchors.
    for name, (index, fields, _) in layout.style_records.items():
        style = by_source.get(name)
        replacements[index] = "Style: " + ",".join(({"Name": style["name"], **style["fields"]})[f] for f in fields) if style else None
    for index, (fields, values) in layout.comments.items():
        style = by_source.get(values["Style"].strip())
        if style is None:
            _fail("样式仍被 ASS Comment 引用，不能删除")
        replacements[index] = "Comment: " + ",".join(style["name"] if f == "Style" else values[f] for f in fields)
    script_values = {"PlayResX": document["script"]["play_res_x"], "PlayResY": document["script"]["play_res_y"],
                     "ScaledBorderAndShadow": document["script"]["scaled_border_and_shadow"]}
    def script_record(key, value):
        return f"{key}: " + (("yes" if value else "no") if type(value) is bool else str(value))
    for key, index in layout.script_records.items():
        value = script_values[key]
        replacements[index] = script_record(key, value) if value is not None else None
    new_script = [script_record(key, value) for key, value in script_values.items() if key not in layout.script_records and value is not None]
    new_styles = ["Style: " + ",".join(({"Name": style["name"], **style["fields"]})[f] for f in layout.style_format)
                  for style in document["styles"] if style["source_name"] is None]
    output = []
    for index in range(len(layout.lines) + 1):
        if index == layout.script_insertion:
            output.extend(new_script)
        if index == layout.style_insertion:
            output.extend(new_styles)
        if index == layout.insertion:
            output.extend(additions)
        if index == len(layout.lines):
            break
        if index in replacements:
            if replacements[index] is not None:
                output.append(replacements[index])
        elif index not in dialogue_lines:
            output.append(layout.lines[index])
    result = "\n".join(output) + "\n"
    _inspect(result)  # Export is held to exactly the same supported subset.
    return result


def empty_document():
    source = """[Script Info]
Title: CueRelay
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: """ + ", ".join(STYLE_FIELDS) + "\nStyle: Default,Local Test Font,28,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1\n\n[Events]\nFormat: " + ", ".join(EVENT_FIELDS) + "\n"
    return parse_ass(source)
