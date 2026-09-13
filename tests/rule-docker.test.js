import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ruleFixture, changedPackage, config, example } from './rule-helpers.js'
import { readPackage } from '../lib/rule-package.js'
import { RuleWorker, requestSnapshot, processOutput } from '../lib/rule-worker.js'
import { ObjectRouter, evaluateRules } from '../lib/rule-router.js'
import { preflight } from '../lib/rule-preflight.js'
import { hash } from '../lib/rule-contract.js'
const enabled = process.env.ROUTER_DOCKER_TEST === '1'

test('real containers: independent admission, publish, exact route, disable and current-environment rollback', { skip: !enabled }, async t => {
  const f = await ruleFixture(t)
  assert.equal((await preflight(config)).ready, true)
  const proof = await f.registry.validate(f.submitted.revision)
  assert.equal(proof.passed, true, JSON.stringify(proof))
  await f.registry.activate(proof.validation_id, proof.generation)
  await writeFile(join(f.root, 'a.txt'), 'alpha')
  const router = new ObjectRouter(f.root), result = await router.route('list visible files')
  assert.equal(result.kind, 'completed', JSON.stringify(result)); assert.equal(result.text, 'a.txt\n')
  assert.equal((await router.route('count visible files')).kind, 'fallback')
  assert.equal((await router.route('list visible files')).text, 'a.txt\n')
  const before = await f.store.read(); await f.registry.disable('list-files', before.generation)
  assert.equal((await router.route('list visible files')).kind, 'fallback')
  await f.registry.rollback('list-files', f.submitted.revision, before.generation + 1)
  assert.equal((await router.route('list visible files')).text, 'a.txt\n')
})

test('real workers: no task files in trigger; read-only executor; timeout/output/protocol failures and complete conflict checks', { skip: !enabled }, async t => {
  const f = await ruleFixture(t), worker = new RuleWorker(), pkg = await readPackage(example)
  await writeFile(join(f.root, 'a.txt'), 'old snapshot')
  const snap = await requestSnapshot(f.root, config); t.after(() => snap.dispose())
  await writeFile(join(f.root, 'later.txt'), 'not in this request')
  const r = await evaluateRules([pkg], 'list visible files', config, snap, worker)
  assert.equal(r.text, 'a.txt\n', JSON.stringify(r))
  const isolation = await changedPackage(t, { 'trigger.py': `import os,socket
assert not os.path.exists('/testbed')
assert not os.path.exists('/.git')
assert not os.path.exists('/setup_nl2b_fs_1.sh')
assert not os.environ.get('DEEPSEEK_API_KEY')
try:
 socket.create_connection(('1.1.1.1',443),timeout=0.1)
 raise RuntimeError('network escaped')
except OSError: pass
try:
 open('/rule/trigger.py','w')
 raise RuntimeError('rule write escaped')
except OSError: pass
def trigger(request,context):
 return {'decision':'no_match','reason_code':'isolated'}
` })
  assert.equal((await evaluateRules([isolation], 'list visible files', config, snap, worker)).reason, 'unmatched')
  const write = await changedPackage(t, { 'executor.py': "def execute(request,args,context):\n open('/testbed/a.txt','w').write('bad')\n return {'status':'completed','result':{'text':'bad'}}\n" })
  assert.equal((await evaluateRules([write], 'list visible files', config, snap, worker)).reason, 'execution-error')
  const timeout = await changedPackage(t, { 'trigger.py': 'while True: pass\n' })
  const deadline = { ...config, triggerTimeoutMs: 500 }
  assert.equal((await evaluateRules([timeout, pkg], 'list visible files', deadline, snap, worker)).reason, 'trigger-error')
  const overflow = await changedPackage(t, { 'trigger.py': "print('x'*200000)\n" })
  assert.equal((await evaluateRules([overflow], 'list visible files', config, snap, worker)).reason, 'trigger-error')
  const malformed = await changedPackage(t, { 'trigger.py': "def trigger(request,context):\n return {'decision':'match','args':{'unexpected':1},'reason_code':'bad'}\n" })
  assert.equal((await evaluateRules([malformed], 'list visible files', config, snap, worker)).reason, 'trigger-error')
  const abstain = await changedPackage(t, { 'trigger.py': "def trigger(request,context):\n return {'decision':'abstain','reason_code':'unsure'}\n" })
  assert.equal((await evaluateRules([abstain], 'list visible files', config, snap, worker)).reason, 'trigger-abstain')
  const m = { ...pkg.manifest, rule_id: 'second-rule' }, files = { ...pkg.files, 'manifest.json': JSON.stringify(m) }
  const second = { files, revision: hash(files), manifest: m }
  assert.equal((await evaluateRules([pkg, second], 'list visible files', config, snap, worker)).reason, 'conflict')
  assert.equal((await evaluateRules([pkg], 'list visible files', { ...config, pythonVersion: '3.0.0' }, snap, worker)).reason, 'trigger-error')
  await writeFile(join(snap.path, 'changed.txt'), 'drift')
  assert.equal((await evaluateRules([pkg], 'list visible files', config, snap, worker)).reason, 'execution-error')
  const live = await processOutput('docker', ['--context', 'colima', 'ps', '--filter', 'name=dsh-rule-', '--format', '{{.Names}}'])
  assert.equal(live.stdout.trim(), '', 'Timed-out containers must be removed')
})
