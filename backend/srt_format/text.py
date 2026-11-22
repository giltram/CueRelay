"""Owned conversions between the validated ASS text subset and SRT inline markup.

No browser/HTML parser, tag stripping, or opaque ASS pass-through. The SRT input
scanner decodes entities only after recognizing markup so escaped tags stay text.
"""
from html import escape
from html.entities import html5
import re

from ass_format import text_tokens
from .errors import SrtError

TAGS = 'bius'
STYLE_FIELDS = ('Bold', 'Italic', 'Underline', 'StrikeOut')
MARKUP = re.compile(r'<(/?)([bius])>', re.IGNORECASE)
TAG_LIKE = re.compile(r'</?[a-zA-Z!/?]')
ENTITY = re.compile(r'&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);', re.IGNORECASE)


def _convert(text, block, *, plain=False):
    """Map a balanced, attribute-free basic tag subset, preserving literal text."""
    output, stack = [], []
    cursor, line = 0, block.line + 2

    def fail(reason, message):
        raise SrtError(reason, message, line=line, block=block.number)

    def literal(value):
        if not plain and any(char in '{}\\' for char in value):
            fail('srt.unrepresentableText', '普通花括号或字面反斜线无法由当前 ASS 子集无损表示；请保留原件。')
        if any(ord(char) < 32 or char in '\u0085\u2028\u2029' for char in value):
            fail('srt.controlCharacter', '正文包含当前文档不支持的控制字符或换行。')
        output.append(value)

    while cursor < len(text):
        char = text[cursor]
        if char == '\n':
            output.append('\n' if plain else r'\N'); line += 1; cursor += 1
            continue
        match = MARKUP.match(text, cursor) if char == '<' else None
        if match:
            closing, tag = match.groups(); tag = tag.lower()
            if closing:
                if not stack or stack[-1] != tag:
                    fail('srt.unbalancedTag', '基础格式标签必须正确配对和嵌套。')
                stack.pop()
                # Nested identical tags restore their enclosing state.
                if not plain:
                    output.append('{\\' + tag + ('1' if tag in stack else '0') + '}')
            else:
                stack.append(tag)
                if not plain:
                    output.append('{\\' + tag + '1}')
            cursor = match.end()
            continue
        if char == '<' and TAG_LIKE.match(text, cursor):
            fail('srt.unsupportedTag', '仅支持无属性的 b/i/u/s 标签；未知或损坏标签不会被静默删除。')
        entity = ENTITY.match(text, cursor) if char == '&' else None
        if entity:
            name = entity[1]
            if name.startswith('#'):
                try:
                    point = int(name[2:], 16) if name[1:2].lower() == 'x' else int(name[1:])
                except ValueError:
                    point = -1
                if point <= 0 or point > 0x10ffff or 0xd800 <= point <= 0xdfff:
                    fail('srt.invalidEntity', '实体必须表示有效 Unicode；不使用替换字符修复。')
                decoded = chr(point)
            else:
                decoded = html5.get(name + ';')
                if decoded is None:
                    fail('srt.invalidEntity', '不支持的具名实体；请使用明确 Unicode 文字或转义 &。')
            literal(decoded)
            cursor = entity.end()
            continue
        literal(char); cursor += 1
    if stack:
        fail('srt.unbalancedTag', '基础格式标签必须正确配对和嵌套。')
    result = ''.join(output)
    if len(result) > 16384:
        fail('srt.textTooLong', '转换后的正文不能超过 16384 字符。')
    return result


def to_ass(text, block):
    return _convert(text, block)


def to_plain(text, block):
    """Same SRT scanner, with formatting omitted and literal ASS characters safe."""
    return _convert(text, block, plain=True)


def from_ass(text, fields):
    """Render effective b/i/u/s state, including the cue's assigned style.

Caller must validate the entire ASS document first. Only known tokens are
consumed; ordinary angle brackets and ampersands are escaped exactly once.
"""
    initial = {tag: fields[field] != '0' for tag, field in zip(TAGS, STYLE_FIELDS)}
    state = dict(initial)
    active, output, plain = [], [], []

    def fragment(value):
        nonlocal active
        if not value:
            return
        plain.append(value)
        wanted = [tag for tag in TAGS if state[tag]]
        if wanted != active:
            output.extend(f'</{tag}>' for tag in reversed(active))
            output.extend(f'<{tag}>' for tag in wanted)
            active = wanted
        output.append(escape(value, quote=False))

    for name, parameter in text_tokens(text):
        if name == 'text':
            fragment(parameter)
        elif name in TAGS:
            state[name] = parameter == '1'
        elif name == 'r':
            state = dict(initial)
        elif name in ('N', 'n', 'h'):
            fragment('\u00a0' if name == 'h' else '\n')
        # Color/alpha and line positioning are explicitly omitted by SRT's
        # existing loss contract. Transparent text becomes visible text.
    output.extend(f'</{tag}>' for tag in reversed(active))
    return ''.join(output), ''.join(plain)
