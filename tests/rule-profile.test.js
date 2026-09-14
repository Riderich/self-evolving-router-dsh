import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ruleFixture, shared } from './rule-helpers.js'
import { processOutput } from '../lib/rule-worker.js'

test('pinned full DSH serves object rule before provider/prompt and records zero model calls', { skip: process.env.ROUTER_PROFILE_TEST !== '1' }, async t => {
  const f = await ruleFixture(t), proof = await f.registry.validate(f.submitted.revision)
  assert.equal(proof.passed, true, JSON.stringify(proof))
  await f.registry.activate(proof.validation_id, proof.generation)
  await writeFile(join(f.root, 'profile.txt'), 'fixture')
  const guard = join(f.root, '.deny-model.mjs')
  const attempts=join(f.root,'.network-attempts');await writeFile(attempts,'')
  await writeFile(guard,`import {appendFileSync} from 'node:fs';globalThis.fetch = async () => {appendFileSync(${JSON.stringify(attempts)},'attempt\\n');throw Error('MODEL_OR_NETWORK_CALL_FORBIDDEN')}\n`)
  const result = await processOutput(process.execPath, ['--import', guard, fileURLToPath(new URL('../run.js', import.meta.url)), 'list visible files'], { timeoutMs: 45000, cwd: f.root })
  assert.equal(result.exitCode, 0, JSON.stringify(result))
  assert.equal(result.stdout.trim(), 'profile.txt', JSON.stringify(result))
  assert.equal(await readFile(attempts,'utf8'),'','Even auxiliary title requests must be absent')
  const state = await f.store.read(), route = state.events.find(e => e.type === 'object-route' && e.kind === 'completed')
  assert.ok(route, JSON.stringify(state.events))
})

test('full DSH fallback usage belongs to object backend and does not start legacy synthesis', { skip: process.env.ROUTER_PROFILE_TEST !== '1' }, async t => {
  const f = await ruleFixture(t)
  await f.store.configure({ enabled: false, pids: 64 })
  const image = (await f.store.read()).config.image
  const control = await mkdtemp(join(shared, 'object-fallback-control-'))
  t.after(() => rm(control, { recursive: true, force: true }))
  const auth = join(control, 'auth.json'), backend = join(control, 'backend.json'), calls = join(control, 'calls.jsonl'), journal = join(control, 'tools.jsonl')
  await writeFile(join(f.root, 'ok.txt'), 'fixture')
  await writeFile(auth, JSON.stringify({ apiKey: 'offline-only', baseURL: 'https://benchmark.invalid/v1' }), { mode: 0o600 })
  await writeFile(backend, JSON.stringify({ root: f.root, image, journal }))
  await writeFile(calls, '')
  const loader = join(f.root, '.mock.mjs')
  await writeFile(loader, `process.env.BENCH_TEST_CALLS=${JSON.stringify(calls)};process.env.BENCH_TEST_COMMAND='ls -1 /testbed';await import(${JSON.stringify(new URL('./mock-benchmark-provider.js', import.meta.url).href)});`)
  const result = await processOutput(process.execPath, ['--import', loader, fileURLToPath(new URL('../run.js', import.meta.url)), '--auth-file', auth, '--benchmark-file', backend, 'list visible files'], { cwd: f.root, timeoutMs: 45000 })
  assert.equal(result.exitCode, 0, JSON.stringify(result))
  const turn = (await f.store.read()).events.find(e => e.type === 'object-agent-turn')
  assert.equal(turn.routed, false); assert.equal(turn.modelMessages, 2); assert.ok(turn.usage.inputTokens > 0)
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2, 'Only base agent tool round trip, no template synthesis')
})
