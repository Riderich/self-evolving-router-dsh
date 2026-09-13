import { randomUUID } from 'node:crypto'
import { processOutput } from './rule-worker.js'
import { packagePath } from './rule-package.js'
import { assert } from './schema.js'
// Trusted editor code, not a model-supplied script. The OS sees only /draft.
const editor = `import os,sys,json
p=json.load(sys.stdin)
root='/draft'
name=p['path']
parts=name.split('/') if name else []
for part in parts:
 if part in ('','..','.') or part.startswith('.') or '\\\\' in part: raise ValueError('Unsafe path')
target=os.path.join(root,*parts)
cur=root
for part in parts:
 cur=os.path.join(cur,part)
 if os.path.islink(cur): raise ValueError('Links forbidden')
command=p['command']
if command=='view':
 if os.path.isdir(target):
  result=[]
  for d,ds,fs in os.walk(target):
   for n in ds+fs:
    x=os.path.join(d,n)
    if os.path.islink(x): raise ValueError('Links forbidden')
   result.extend(os.path.relpath(os.path.join(d,n),root) for n in fs)
  print(json.dumps({'files':sorted(result)}))
 else:
  if os.path.getsize(target)>262144: raise ValueError('File too large')
  with open(target) as f: text=f.read()
  print(json.dumps({'path':name,'text':text}))
else:
 before=None
 if os.path.exists(target):
  if os.path.getsize(target)>262144: raise ValueError('File too large')
  with open(target) as f: before=f.read()
 if command=='create':
  if before is not None: raise ValueError('Already exists')
  after=p['file_text']
 elif command=='str_replace':
  old=p.get('old_str','')
  if before is None or not old or before.count(old)!=1: raise ValueError('Replacement requires unique existing text')
  after=before.replace(old,p.get('new_str',''),1)
 elif command=='insert':
  if before is None: raise ValueError('Missing file')
  lines=before.split('\\n'); line=p['insert_line']
  if type(line)!=int or line<0 or line>len(lines): raise ValueError('Invalid line')
  lines[line:line]=p['new_str'].split('\\n'); after='\\n'.join(lines)
 else: raise ValueError('Unknown edit')
 if len(after.encode())>65536: raise ValueError('Output file too large')
 total=0; count=0
 for d,ds,fs in os.walk(root):
  for n in ds+fs:
   if os.path.islink(os.path.join(d,n)): raise ValueError('Links forbidden')
  for n in fs: total+=os.path.getsize(os.path.join(d,n)); count+=1
 if count+(before is None)>64 or total-len((before or '').encode())+len(after.encode())>262144: raise ValueError('Draft limit')
 os.makedirs(os.path.dirname(target),exist_ok=True)
 temp=target+'.editing'
 with open(temp,'x') as f: f.write(after)
 os.replace(temp,target)
 print(json.dumps({'path':name,'before':before,'after':after}))
`
export async function editDraft(directory, args, config, allowed, signal) {
  const path = args.path === '/draft' ? '' : String(args.path ?? '').replace(/^\/draft\//, '')
  assert(path === '' && args.command === 'view' || packagePath(path), 'Editor path must be /draft or a package file')
  assert(['view', 'create', 'str_replace', 'insert'].includes(args.command), 'Unknown editor command')
  if (args.command !== 'view') assert(allowed.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix), 'File is outside declared edit scope')
  const payload = JSON.stringify({ ...args, path }); assert(Buffer.byteLength(payload) <= 150000, 'Editor input too large')
  assert(!directory.includes(','), 'Unsupported mount directory')
  const prefix = config.dockerContext ? ['--context', config.dockerContext] : [], name = `dsh-edit-${randomUUID()}`
  const start = performance.now()
  try {
    const r = await processOutput(config.dockerCommand, [...prefix, 'run', '--rm', '--pull=never', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534', '--pids-limit', '16', '--memory', '128m', '--cpus', '1', '--mount', `type=bind,source=${directory},target=/draft`, '--workdir', '/draft', '--entrypoint', 'python3', '-i', config.image, '-I', '-B', '-c', editor], { input: payload, signal, timeoutMs: 10000, maxOutputBytes: 300000 })
    assert(r.exitCode === 0, `Editor failed: ${r.stderr.slice(-1500)}`)
    return { ...JSON.parse(r.stdout), durationMs: performance.now() - start }
  } finally {
    const r = await processOutput(config.dockerCommand, [...prefix, 'rm', '-f', name], { timeoutMs: 5000 })
    assert(r.exitCode === 0 || /No such container/.test(r.stderr), 'Editor cleanup failed')
  }
}
