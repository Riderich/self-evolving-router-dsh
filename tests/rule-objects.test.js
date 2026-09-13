import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, symlink, mkdir, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { ruleFixture, fakeWorker, example } from './rule-helpers.js'
import { readPackage, checkPackage } from '../lib/rule-package.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { RuleRegistry } from '../lib/rule-registry.js'
import { RuleStore } from '../lib/rule-store.js'
import { schema } from '../lib/rule-contract.js'

test('package digest includes helpers and rejects symlinks, missing files, schema escape and mutation', async t => {
  const { root } = await ruleFixture(t, { worker: fakeWorker })
  const p = await readPackage(example)
  assert.throws(() => checkPackage({ files: { ...p.files, 'helpers/x.py': 'x=1' }, revision: p.revision }), /digest/)
  assert.throws(() => checkPackage({ files: { ...p.files, '../escape.py': 'x=1' } }), /file/)
  assert.throws(() => schema({ type: 'string', maxLength: 10, pattern: '(a+)+$' }), /fields/)
  const draft = join(root, 'draft'); await cp(example, draft, { recursive: true })
  await symlink('/etc/passwd', join(draft, 'escape.txt')); await assert.rejects(readPackage(draft), /links/)
})
test('validation publishes immutable code; conflicts, suite/config drift and revoked rollback fail closed', async t => {
  const { root, store, registry, submitted } = await ruleFixture(t, { worker: fakeWorker })
  const proof = await registry.validate(submitted.revision)
  assert.equal(proof.passed, true)
  await registry.activate(proof.validation_id, proof.generation)
  const router = new ObjectRouter(root, { worker: fakeWorker })
  await writeFile(join(root, 'a.txt'), 'a')
  const result = await router.route('list visible files'); assert.equal(result.kind, 'completed'); assert.equal(result.text, 'a.txt\n')
  await assert.rejects(registry.activate(proof.validation_id, proof.generation), /Stale/)
  const current = await store.read()
  await registry.disable('list-files', current.generation, { revoke: true })
  assert.equal((await router.route('list visible files')).kind, 'fallback')
  await assert.rejects(registry.rollback('list-files', submitted.revision, current.generation + 1), /revoked/)
})
test('concurrent publication admits one winner; restart preserves state; stale suite invalidates serving', async t => {
  const { root, store, registry, submitted } = await ruleFixture(t, { worker: fakeWorker })
  const proof = await registry.validate(submitted.revision)
  const results = await Promise.allSettled([registry.activate(proof.validation_id, proof.generation), registry.activate(proof.validation_id, proof.generation)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const recovered = new RuleStore(root); assert.equal((await recovered.read()).active['list-files'].revision, submitted.revision)
  const suite = JSON.parse(await readFile(join(store.dir, 'admission.json'))); suite.cases[0].text = 'wrong\n'
  await writeFile(join(store.dir, 'admission.json'), JSON.stringify(suite))
  const r = await new ObjectRouter(root, { worker: fakeWorker }).route('list visible files'); assert.equal(r.kind, 'fallback'); assert.match(r.detail, /Stale/)
  await store.configure({ triggerTimeoutMs: 4000 }); assert.deepEqual((await store.read()).active, {})
})
test('revocation after match prevents execution and after execution prevents return', async t => {
  const f = await ruleFixture(t, { worker: fakeWorker }), proof = await f.registry.validate(f.submitted.revision)
  await f.registry.activate(proof.validation_id, proof.generation)
  let executed = false
  const worker = { async run(...args) {
    const result = await fakeWorker.run(...args)
    if (args[1] === 'trigger') { const s = await f.store.read(); await f.registry.disable('list-files', s.generation) }
    else executed = true
    return result
  } }
  assert.equal((await new ObjectRouter(f.root, { worker }).route('list visible files')).kind, 'fallback'); assert.equal(executed, false)
  const p2 = await f.registry.validate(f.submitted.revision); await f.registry.activate(p2.validation_id, p2.generation)
  worker.run = async (...args) => { const r = await fakeWorker.run(...args); if (args[1] === 'executor') { const s = await f.store.read(); await f.registry.disable('list-files', s.generation) }; return r }
  assert.equal((await new ObjectRouter(f.root, { worker }).route('list visible files')).kind, 'fallback')
})
test('failed state transaction preserves old active set and rollback revalidates instead of copying pointer', async t => {
  const f = await ruleFixture(t, { worker: fakeWorker }), proof = await f.registry.validate(f.submitted.revision)
  await f.registry.activate(proof.validation_id, proof.generation)
  const before = await f.store.read()
  await assert.rejects(f.store.transaction(s => { s.active = {}; throw Error('simulated pre-commit interruption') }))
  assert.deepEqual((await f.store.read()).active, before.active)
  await f.registry.disable('list-files', before.generation)
  const reg = new RuleRegistry(new RuleStore(f.root), { worker: fakeWorker })
  await reg.rollback('list-files', f.submitted.revision, before.generation + 1)
  assert.equal(Object.keys((await f.store.read()).proofs).length, 2)
})

test('process death releases stale lock on recovery without committing a half update', async t => {
  const f = await ruleFixture(t, { worker: fakeWorker }), proof = await f.registry.validate(f.submitted.revision)
  await f.registry.activate(proof.validation_id, proof.generation)
  const before = await f.store.read()
  const { processOutput } = await import('../lib/rule-worker.js')
  const child = `import {RuleStore} from ${JSON.stringify(new URL('../lib/rule-store.js', import.meta.url).href)}; const store=new RuleStore(${JSON.stringify(f.root)}); await store.transaction(s=>{s.active={};process.kill(process.pid,'SIGKILL')});`
  const r = await processOutput(process.execPath, ['--input-type=module', '-e', child])
  assert.notEqual(r.exitCode, 0)
  const recovered = new RuleStore(f.root)
  assert.deepEqual((await recovered.read()).active, before.active)
  await recovered.transaction(s => { s.recovery_test = true })
  assert.deepEqual((await recovered.read()).active, before.active)
})

test('configured disabled object backend never silently revives an old active template', async t => {
  const f = await ruleFixture(t, { worker: fakeWorker })
  await f.store.configure({ enabled: false })
  const { Router } = await import('../lib/runtime.js')
  const legacy = new Router(f.root)
  legacy.decide = async () => { throw Error('legacy must not run') }
  const r = await legacy.route('list visible files')
  assert.equal(r.kind, 'fallback'); assert.equal(r.reason, 'disabled-or-veto'); assert.equal(r.backend, 'executable-rule-v1')
})
