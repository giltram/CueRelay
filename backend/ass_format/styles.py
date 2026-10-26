"""ASS style values, IDs and conservative script-space adaptation. No ORM/I/O."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from uuid import UUID
from .errors import fail

STYLE_FIELDS = "Name Fontname Fontsize PrimaryColour SecondaryColour OutlineColour BackColour Bold Italic Underline StrikeOut ScaleX ScaleY Spacing Angle BorderStyle Outline Shadow Alignment MarginL MarginR MarginV Encoding".split()
ATTRIBUTE_FIELDS = STYLE_FIELDS[1:]
COLORS = ("PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour")
FLAGS = ("Bold", "Italic", "Underline", "StrikeOut")
NUMBERS = ("Fontsize", "ScaleX", "ScaleY", "Spacing", "Angle", "Outline", "Shadow")
INTEGERS = ("BorderStyle", "Alignment", "MarginL", "MarginR", "MarginV", "Encoding")
MAX_STYLES = 1000  # Also subject to the existing 1MiB exported document limit.


def validate_name(value, line=None):
    if (not isinstance(value, str) or not value or value != value.strip() or len(value) > 100
            or any(ord(c) < 32 or c in ",\u0085\u2028\u2029" for c in value)):
        fail("名称须为 1–100 字符，不能包含逗号、换行或首尾空白", line)
    try:
        value.encode('utf-8')
    except UnicodeError:
        fail("名称含无效 Unicode", line)
    return value


def validate_values(values, line=None):
    if not isinstance(values, dict) or set(values) != set(STYLE_FIELDS) or any(not isinstance(v, str) for v in values.values()):
        fail("样式必须包含完整标准 ASS 字段，属性值须为字符串", line)
    if any(len(value) > 100 or value != value.strip() or any(ord(c) < 32 or c in ',\u0085\u2028\u2029' for c in value) for value in values.values()):
        fail("样式字段须为不超过 100 字符的单行值，不能包含逗号或首尾空白", line)
    for name in ("Name", "Fontname"):
        validate_name(values[name], line)
    for name in COLORS:
        if not re.fullmatch(r"&H[0-9a-fA-F]{8}", values[name]):
            fail("样式颜色须为 &HAABBGGRR（AA=00 不透明，FF 透明）", line)
    for name in FLAGS:
        if values[name] not in ("0", "-1"):
            fail("样式布尔值须为 0 或 -1", line)
    for name in NUMBERS:
        try:
            number = Decimal(values[name])
        except InvalidOperation:
            fail(f"非法样式数字 {name}", line)
        # copy_abs is exact and context-free: abs() can overflow on exponents
        # or round a value just above the limit back down to 10000.
        if not number.is_finite() or number.copy_abs() > 10000:
            fail(f"样式数字 {name} 须为有限数且绝对值不超过 10000", line)
        if name in ("Fontsize", "ScaleX", "ScaleY") and number <= 0:
            fail(f"样式 {name} 必须大于零", line)
    for name in INTEGERS:
        if not re.fullmatch(r"[0-9]{1,5}", values[name]):
            fail(f"非法样式整数 {name}", line)
    if values["BorderStyle"] not in ("1", "3") or int(values["Alignment"]) not in range(1, 10):
        fail("非法 BorderStyle 或 Alignment", line)


def validate_fields(fields):
    if not isinstance(fields, dict) or set(fields) != set(ATTRIBUTE_FIELDS):
        fail("样式属性须完整且只含标准 ASS 属性")
    validate_values({"Name": "Validation", **fields})


def validate_id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        fail("样式 ID 必须是规范 UUID")


def validate_script(script, allow_partial=False):
    if not isinstance(script, dict) or set(script) != {"play_res_x", "play_res_y", "scaled_border_and_shadow"}:
        fail("脚本设置须包含 play_res_x、play_res_y、scaled_border_and_shadow")
    for key in ("play_res_x", "play_res_y"):
        value = script[key]
        if allow_partial and value is None:
            continue
        if type(value) is not int or not 1 <= value <= 32768:
            fail("PlayRes 须为 1–32768 的整数；缺失值不能根据视频自动推断")
    if type(script["scaled_border_and_shadow"]) is not bool and not (allow_partial and script["scaled_border_and_shadow"] is None):
        fail("边框缩放设置须为布尔值")


def validate_styles(styles, source_names):
    if not isinstance(styles, list) or not 1 <= len(styles) <= MAX_STYLES:
        fail(f"文档须有 1–{MAX_STYLES} 个样式（同时受 1MiB 限制）")
    ids, names, anchors = set(), set(), set()
    for style in styles:
        if not isinstance(style, dict) or set(style) != {"id", "name", "fields", "source_name", "origin"}:
            fail("样式对象字段不符合 v2 契约")
        validate_id(style["id"])
        validate_name(style["name"])
        validate_fields(style["fields"])
        if style["id"] in ids or style["name"] in names:
            fail("样式 ID 与名称须分别唯一")
        ids.add(style["id"]); names.add(style["name"])
        anchor = style["source_name"]
        if anchor is not None:
            if not isinstance(anchor, str) or anchor not in source_names or anchor in anchors:
                fail("样式 source_name 须唯一引用原始模板样式")
            anchors.add(anchor)
        origin = style["origin"]
        if origin is not None:
            if not isinstance(origin, dict) or set(origin) != {"template_id", "revision"}:
                fail("模板来源字段不符合契约")
            validate_id(origin["template_id"])
            if type(origin["revision"]) is not int or origin["revision"] < 1:
                fail("模板来源 revision 须为正整数")


def adapt_fields(fields, reference, target, mode):
    """copy always preserves values. scale only supports equal aspect + scaled borders.

    Decimal arithmetic; margins use half-up integer rounding, other geometry uses
    half-up to six decimal places. Percentages, angle and non-geometry stay intact.
    """
    validate_fields(fields)
    if mode not in ("copy", "scale"):
        fail("适配方式须为 copy 或 scale")
    if mode == "copy":
        return dict(fields)
    validate_script(reference)
    validate_script(target)
    if reference["play_res_x"] * target["play_res_y"] != target["play_res_x"] * reference["play_res_y"]:
        fail("宽高比不同，仅支持原样复制后人工调整")
    if not reference["scaled_border_and_shadow"] or not target["scaled_border_and_shadow"]:
        fail("等比适配要求源和目标 ScaledBorderAndShadow 均为 yes；请选择原样复制后人工调整")
    factor = Decimal(target["play_res_y"]) / Decimal(reference["play_res_y"])
    result = dict(fields)
    for key in ("Fontsize", "Spacing", "Outline", "Shadow", "MarginL", "MarginR", "MarginV"):
        step = Decimal(1) if key.startswith("Margin") else Decimal('0.000001')
        value = (Decimal(fields[key]) * factor).quantize(step, rounding=ROUND_HALF_UP)
        result[key] = format(value, 'f').rstrip('0').rstrip('.') if step != 1 else str(int(value))
        if not result[key] or result[key] == '-0':
            result[key] = '0'
    validate_fields(result)
    return result
