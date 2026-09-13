// Persistent no-model engineering acceptance. Never invokes a model provider.
import { mkdir, realpath, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { RuleStore } from '../lib/rule-store.js'
import { RuleRegistry } from '../lib/rule-registry.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { preflight } from '../lib/rule-preflight.js'
import { processOutput } from '../lib/rule-worker.js'
import { KERNEL_HASH } from '../lib/rule-contract.js'
if (!process.argv[2]) throw Error('Usage: node scripts/object-acceptance.mjs NEW_OUTPUT_DIRECTORY')
const output = resolve(process.argv[2]); await mkdir(output) // Never overwrite a prior run.
const root = join(output, 'workspace'); await mkdir(root)
const shared = fileURLToPath(new URL('../.sandbox/', import.meta.url)); await mkdir(shared, { recursive: true })
const config = { enabled: true, image: 'sha256:a6e963c9905946f5b8a81855f0c264fcdaed2dadbd4e982be28da4fe2499df0f', pythonVersion: '3.14.4', snapshotDirectory: shared, triggerTimeoutMs: 2000, routeTimeoutMs: 30000 }
const store = new RuleStore(await realpath(root)), registry = new RuleRegistry(store)
await store.configure(config)
const readiness = await preflight((await store.read()).config)
await writeFile(join(output, 'preflight.json'), JSON.stringify(readiness, null, 2)); assert.equal(readiness.ready, true)
await registry.addSource('manual-example-list-files', { kind: 'manual-control', reference: 'examples/rules/list-files' })
await writeFile(join(store.dir, 'admission.json'), await readFile(new URL('../examples/rule-admission.json', import.meta.url)))
const submitted = await registry.submit(fileURLToPath(new URL('../examples/rules/list-files/', import.meta.url)))
const proof = await registry.validate(submitted.revision); assert.equal(proof.passed, true, JSON.stringify(proof))
await registry.activate(proof.validation_id, proof.generation)
await writeFile(join(root, 'accepted.txt'), 'new file after admission\n')
const router = new ObjectRouter(root)
const routed = await router.route('list visible files'), fallback = await router.route('count visible files')
assert.equal(routed.text, 'accepted.txt\n'); assert.equal(fallback.kind, 'fallback')
const guard = join(root, '.deny-model.mjs'), calls = join(output, 'forbidden-calls.jsonl')
await writeFile(calls, '')
await writeFile(guard, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch=async()=>{appendFileSync(${JSON.stringify(calls)},'fetch\\n');throw Error('MODEL_NETWORK_FORBIDDEN')};\n`)
const dsh = await processOutput(process.execPath, ['--import', guard, fileURLToPath(new URL('../run.js', import.meta.url)), 'list visible files'], { cwd: root, timeoutMs: 45000 })
await writeFile(join(output, 'dsh.json'), JSON.stringify(dsh, null, 2))
assert.equal(dsh.exitCode, 0, JSON.stringify(dsh)); assert.equal(dsh.stdout.trim(), 'accepted.txt'); assert.equal(await readFile(calls, 'utf8'), '')
let state = await store.read(); await registry.disable('list-files', state.generation)
assert.equal((await router.route('list visible files')).kind, 'fallback')
state = await store.read(); await registry.rollback('list-files', submitted.revision, state.generation)
assert.equal((await router.route('list visible files')).text, 'accepted.txt\n')
state = await store.read()
await writeFile(join(output, 'events.json'), JSON.stringify(state.events, null, 2))
await writeFile(join(output, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), backend: 'executable-rule-v1', kernelHash: KERNEL_HASH, config: state.config, source: 'manual engineering fixture', modelCalls: 0, paidCalls: 0, revision: submitted.revision, suite: 'adaptive engineering admission, not sealed', stages: ['preflight', 'submit', 'validate', 'activate', 'route', 'fallback', 'real-dsh', 'disable', 'revalidated-rollback'], triggerMs: routed.triggers.map(t=>t.durationMs), executionMs: routed.execution.durationMs, routeMs: routed.durationMs, noMatchMs: fallback.durationMs, dshMeasuredBy: 'separate process with forbidden fetch guard', noResearchSavingsClaim: true }, null, 2))
console.log(JSON.stringify({ output, passed: true, modelCalls: 0, revision: submitted.revision }))
