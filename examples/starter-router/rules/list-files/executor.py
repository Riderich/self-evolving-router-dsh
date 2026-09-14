import os

def execute(request, args, context):
    try:
        with os.scandir(context['root']) as entries:
            names = sorted(e.name for e in entries if e.is_file(follow_symlinks=False))
        return {'status': 'completed', 'result': {'text': ''.join(n + '\n' for n in names)}}
    except OSError:
        return {'status': 'fallback', 'reason_code': 'read_error'}
