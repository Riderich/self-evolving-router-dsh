import os


def execute(request, args, context):
    try:
        root = context['root']
    except (KeyError, TypeError):
        return {'status': 'fallback', 'reason_code': 'unavailable'}

    try:
        entries = sorted(os.listdir(root))
    except OSError:
        return {'status': 'fallback', 'reason_code': 'unavailable'}

    lines = [name for name in entries if os.path.exists(os.path.join(root, name))]
    text = ''.join(name + '\n' for name in lines)
    return {'status': 'completed', 'result': {'text': text}}
