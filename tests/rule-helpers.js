import { mkdtemp, realpath, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleStore } from '../lib/rule-store.js'
import { RuleRegistry } from '../lib/rule-registry.js'
import { readPackage } from '../lib/rule-package.js'
import { hash } from '../lib/rule-contract.js'
export const example = fileURLToPath(new URL('../examples/rules/list-files/', import.meta.url))
export const shared = fileURLToPath(new URL('../.sandbox/', import.meta.url))
export const config = { enabled: true, image: process.env.ROUTER_TEST_IMAGE ?? 'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285', pythonVersion: process.env.ROUTER_TEST_PYTHON ?? '3.13.15', dockerContext: process.env.ROUTER_DOCKER_CONTEXT ?? 'colima', snapshotDirectory: shared, triggerTimeoutMs: 5000, routeTimeoutMs: 30000 }
export async function ruleFixture(t, options = {}) {
  await mkdir(shared, { recursive: true })
  const root = await realpath(await mkdtemp(join(shared, 'object-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new RuleStore(root), registry = new RuleRegistry(store, options)
  await store.configure(config)
  await registry.addSource('manual-example-list-files', { kind: 'manual-control', reference: 'examples/rules/list-files' })
  await writeFile(join(store.dir, 'admission.json'), await readFile(new URL('../examples/rule-admission.json', import.meta.url)))
  const submitted = await registry.submit(example)
  return { root, store, registry, submitted }
}
export async function changedPackage(t, files) {
  const original = await readPackage(example)
  const result = { ...original.files, ...files }
  return { files: result, revision: hash(result), manifest: JSON.parse(result['manifest.json']) }
}
export const fakeWorker = { async run(pkg, phase, payload) {
  if (phase === 'trigger') return { result: payload.request === 'list visible files' ? { decision: 'match', args: {}, reason_code: 'test' } : { decision: 'no_match', reason_code: 'test' }, durationMs: 1 }
  const { readdir } = await import('node:fs/promises')
  const snap = arguments[4]
  return { result: { status: 'completed', result: { text: (await readdir(snap.path)).sort().map(n => n + '\n').join('') } }, durationMs: 1 }
} }
