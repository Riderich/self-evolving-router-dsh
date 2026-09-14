import os

def execute(request, args, context):
    try:
        with os.scandir(context['root']) as entries:
            names = sorted(e.name for e in entries if e.is_file(follow_symlinks=False))
        return {'status': 'completed', 'result': {'text': str(len(names)) + '\n'}}
    except OSError:
        return {'status': 'fallback', 'reason_code': 'read_error'}
