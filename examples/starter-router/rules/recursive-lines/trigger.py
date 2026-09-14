import re

_PATTERN = re.compile(r'count lines in all ([a-z0-9]{1,12}) files in /testbed recursively', re.ASCII | re.IGNORECASE)

def trigger(request, context):
    match = _PATTERN.fullmatch(request.strip()) if isinstance(request, str) else None
    if match:
        return {'decision':'match','args':{'extension':match.group(1).lower()},'reason_code':'supported'}
    return {'decision':'no_match','reason_code':'unsupported'}
