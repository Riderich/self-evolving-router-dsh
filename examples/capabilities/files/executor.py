import os

def execute(task, context):
    args=task['args'];root=args['root'];base=context['root']
    if not(root==base or root.startswith(base+'/')) or '..' in root.split('/'):
        return {'status':'fallback','reason':'scope'}
    def fail(error):raise error
    try:
        if not os.path.isdir(root):return {'status':'fallback','reason':'missing_directory'}
        paths=[]
        for directory,dirs,names in os.walk(root,onerror=fail,followlinks=False):
            dirs[:]=sorted(d for d in dirs if d not in args['exclude_dirs'])
            for name in sorted(names):
                p=os.path.join(directory,name)
                if os.path.isfile(p) and not os.path.islink(p) and (not args['extension'] or name.endswith('.'+args['extension'])):paths.append(p)
            if not args['recursive']:break
        if task['operation']=='files.list':value=sorted(os.path.relpath(p,root) for p in paths)
        elif task['operation']=='text.count_newlines':
            value=0
            for p in paths:
                with open(p,'rb') as f:
                    while True:
                        block=f.read(65536)
                        if not block:break
                        value+=block.count(b'\n')
        else:return {'status':'fallback','reason':'operation'}
        return {'status':'completed','value':value}
    except OSError:return {'status':'fallback','reason':'read_error'}
