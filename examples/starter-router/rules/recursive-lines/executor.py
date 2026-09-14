import os

def execute(request, args, context):
    total = 0
    def fail(error):
        raise error
    try:
        for directory, dirs, names in os.walk(context['root'], onerror=fail, followlinks=False):
            for name in names:
                if name.endswith('.' + args['extension']):
                    with open(os.path.join(directory, name), 'rb') as stream:
                        while True:
                            block = stream.read(65536)
                            if not block:
                                break
                            total += block.count(b'\n')
        return {'status': 'completed', 'result': {'text': str(total) + '\n'}}
    except OSError:
        return {'status': 'fallback', 'reason_code': 'read_error'}
