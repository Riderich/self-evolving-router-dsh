import os
import re

_SUPPORTED = re.compile(
    r'^(?:list|show|display|get|print)\s+(?:the\s+)?(?:visible\s+)?files?$',
    re.IGNORECASE,
)


def trigger(request, context):
    if not isinstance(request, str):
        return {'decision': 'abstain', 'reason_code': 'unsupported'}
    text = request.strip()
    if _SUPPORTED.match(text):
        return {
            'decision': 'match',
            'args': {},
            'reason_code': 'supported',
        }
    return {'decision': 'abstain', 'reason_code': 'unsupported'}
