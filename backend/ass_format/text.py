"""The editable ASS body grammar, shared by validation and format consumers.

Tokens preserve raw parameters. They are not a second writable document model.
All text must be checked before a caller consumes tokens for a lossy conversion.
"""
import re
from decimal import Decimal

from message_contracts import localized
from .errors import fail

TAG = re.compile(r'(alpha|[1-4][ca]|an|pos|[biusc]|r)(.*)', re.DOTALL)
COLOR = re.compile(r'&H[0-9a-fA-F]{1,6}&')
ALPHA = re.compile(r'&H[0-9a-fA-F]{1,2}&?')
NUMBER = r'[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)'
POSITION = re.compile(r'\([ \t]*(' + NUMBER + r')[ \t]*,[ \t]*(' + NUMBER + r')[ \t]*\)')


def _override(raw, line):
    match = TAG.fullmatch(raw)
    if match:
        name, parameter = match.groups()
        valid = False
        if name in 'bius':
            valid = parameter in ('0', '1')
        elif name in ('c', '1c', '2c', '3c', '4c'):
            valid = not parameter or COLOR.fullmatch(parameter)
        elif name in ('alpha', '1a', '2a', '3a', '4a'):
            valid = not parameter or ALPHA.fullmatch(parameter)
        elif name == 'an':
            valid = parameter in '123456789' and len(parameter) == 1
        elif name == 'pos':
            position = POSITION.fullmatch(parameter)
            valid = position and all(Decimal(value).copy_abs() <= 32768 for value in position.groups())
        elif name == 'r':
            valid = not parameter
        if valid:
            return name, parameter
    fail(localized('server.invalidAssOverride', 'ASS 标签不受支持或参数无效：\\{{tag}}', {'tag': raw[:80]}), line)


def text_tokens(value, line=None):
    """Validate a complete body and return (name, parameter) tokens.

    Ordinary spans use name='text'; escapes use N/n/h with an empty parameter.
    No partial result is returned on an unsupported or malformed instruction.
    """
    if not isinstance(value, str) or len(value) > 16_384:
        fail(localized('server.subtitleTextMustBeAStringOfAtMost', '字幕文本须为不超过 16384 字符的字符串', {}), line)
    tokens = []
    line_tags = set()
    cursor = plain_start = 0
    while cursor < len(value):
        char = value[cursor]
        if ord(char) < 32 or char in "\u0085\u2028\u2029":
            fail(localized('server.subtitleTextMustNotContainControlCharactersUseN', '字幕不能包含控制字符；换行请使用 \\N', {}), line)
        if char in '{\\':
            if plain_start < cursor:
                tokens.append(('text', value[plain_start:cursor]))
            if char == '{':
                end = value.find('}', cursor)
                if end < 0:
                    fail(localized('server.unmatchedAssBraces', 'ASS 花括号未配对', {}), line)
                block = value[cursor + 1:end]
                if not block.startswith('\\'):
                    fail(localized('server.invalidAssOverride', 'ASS 标签不受支持或参数无效：\\{{tag}}', {'tag': block[:80]}), line)
                for raw in block[1:].split('\\'):
                    name, parameter = _override(raw, line)
                    if name in ('an', 'pos'):
                        if name in line_tags:
                            fail(localized('server.duplicateAssLineOverride', '每条字幕最多一个 \\{{tag}} 标签，重置不能清除整行定位。', {'tag': name}), line)
                        line_tags.add(name)
                    tokens.append((name, parameter))
                cursor = end + 1
            else:
                if cursor + 1 >= len(value) or value[cursor + 1] not in 'Nnh':
                    fail(localized('server.textOnlySupportsNNAndHEscapes', '文本仅支持 \\N、\\n、\\h 转义', {}), line)
                tokens.append((value[cursor + 1], ''))
                cursor += 2
            plain_start = cursor
        elif char == '}':
            fail(localized('server.unmatchedAssBraces', 'ASS 花括号未配对', {}), line)
        else:
            cursor += 1
    if plain_start < cursor:
        tokens.append(('text', value[plain_start:cursor]))
    return tokens
