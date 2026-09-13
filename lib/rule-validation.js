import { readFile, lstat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assert, object, requestVeto } from './schema.js'
import { hash, environmentKey, id, keys } from './rule-contract.js'
import { checkPackage } from './rule-package.js'
import { RuleWorker, requestSnapshot } from './rule-worker.js'
import { evaluateRules } from './rule-router.js'
import { event } from './store.js'
export async function loadRuleSuite(store) {
  const p = join(store.dir, 'admission.json'), st = await lstat(p)
  assert(st.isFile() && !st.isSymbolicLink() && st.size <= 1024 * 1024, 'Invalid admission file')
  return validateSuite(JSON.parse(await readFile(p, 'utf8')))
}
export function validateSuite(suite) {
  keys(suite, ['version', 'cases'], 'admission suite'); assert(suite.version === 1 && Array.isArray(suite.cases) && suite.cases.length >= 2 && suite.cases.length <= 64, 'Invalid admission suite')
  const seen = new Set()
  for (const c of suite.cases) {
    keys(c, ['id', 'request', 'rule_id', 'args', 'text', 'files'], 'admission case')
    assert(typeof c.id === 'string' && c.id.length > 0 && !seen.has(c.id), 'Invalid case ID'); seen.add(c.id)
    assert(typeof c.request === 'string' && c.request.length <= 4096 && (c.rule_id === null || id(c.rule_id)), 'Invalid case')
    assert(c.rule_id === null || (typeof c.text === 'string' && object(c.args) && !requestVeto(c.request)), 'Missing exact oracle/args or vetoed positive')
    assert(object(c.files) && Object.keys(c.files).length <= 64, 'Invalid fixture')
    let size = 0
    for (const [p, v] of Object.entries(c.files)) {
      assert(p.length <= 200 && p.split('/').every(x => x && x !== '..' && !x.startsWith('.') && !['node_modules', 'vendor'].includes(x)) && !/[\\\0]/.test(p), 'Unsafe fixture path')
      assert(typeof v === 'string', 'Invalid fixture content'); size += Buffer.byteLength(v)
    }
    assert(size <= 128 * 1024, 'Fixture too large')
  }
  return suite
}
export async function validateCollection(store, target, { worker = new RuleWorker(), signal, expectedGeneration, coverage = {} } = {}) {
  const started = performance.now(), s = await store.read(), suite = await loadRuleSuite(store), validation_id = randomUUID()
  assert(expectedGeneration === undefined || s.generation === expectedGeneration, 'Stale registry generation before validation')
  assert(object(target) && Object.keys(target).length <= s.config.maxRules, 'Invalid target collection')
  const packages = Object.entries(target).map(([rule_id, rev]) => {
    assert(id(rule_id) && s.packages[rev] && !s.revoked[rev], 'Unknown/revoked revision')
    const pkg = checkPackage({ files: s.packages[rev].files, revision: rev }); assert(pkg.manifest.rule_id === rule_id, 'Target identity mismatch'); return pkg
  })
  coverage = { ...Object.fromEntries(Object.entries(s.active).filter(([k]) => target[k]).map(([k,a]) => [k, s.proofs[a.validation_id]?.coverage?.[k] ?? [k]])), ...coverage }
  for (const k of Object.keys(target)) coverage[k] ??= [k]
  assert(Object.entries(coverage).every(([k,ids]) => target[k] && Array.isArray(ids) && ids.length && ids.every(id)), 'Invalid trusted coverage mapping')
  for (const pkg of packages) {
    const ids = coverage[pkg.manifest.rule_id]
    assert(suite.cases.some(c => ids.includes(c.rule_id)) && suite.cases.some(c => !ids.includes(c.rule_id)), 'Each rule needs trusted positive and boundary cases')
  }
  // Deleting a rule is allowed to abstain on its old positives, but may not redirect
  // them to another rule. Existing target rules must preserve every old oracle.
  const results = []
  for (const c of suite.cases) {
    let root, snap; const runs = []
    try {
      await mkdir(s.config.snapshotDirectory, { recursive: true })
      root = await mkdtemp(join(s.config.snapshotDirectory, 'rule-validation-'))
      for (const [p, text] of Object.entries(c.files)) { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), text) }
      snap = await requestSnapshot(root, s.config)
      for (let repetition = 0; repetition < 2; repetition++) {
        const deadline = AbortSignal.timeout(s.config.routeTimeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline
        const output = requestVeto(c.request) ? { kind: 'fallback', reason: 'hard-veto', triggers: [] } : await evaluateRules(packages, c.request, s.config, snap, worker, combined)
        runs.push(output)
      }
      const expectedRules = Object.keys(target).filter(k => coverage[k].includes(c.rule_id))
      const expectedRule = expectedRules.length ? c.rule_id : null
      const good = r => {
        if (expectedRule === null) return r.kind === 'fallback' && ['unmatched', 'trigger-abstain', 'hard-veto'].includes(r.reason)
        const match = r.triggers.find(t => t.rule_id === r.program)?.result
        return r.kind === 'completed' && expectedRules.includes(r.program) && r.text === c.text && hash(match?.args) === hash(c.args)
      }
      const behavior = r => ({ kind: r.kind, reason: r.reason, text: r.text, triggers: r.triggers?.map(t => ({ rule_id: t.rule_id, result: t.result, error: t.error })) })
      const environmentError = runs.some(r => r.execution?.errorKind === 'environment-error' || r.triggers?.some(t => t.errorKind === 'environment-error'))
      results.push({ case_id: c.id, request: c.request, passed: !environmentError && runs.every(good) && hash(behavior(runs[0])) === hash(behavior(runs[1])), ...(environmentError ? { validation_error: 'Runtime environment unavailable or changed' } : {}), expected: { rule_id: expectedRule, allowed_rules: expectedRules, text: c.text, args: c.args }, runs })
    } catch (e) { results.push({ case_id: c.id, passed: false, validation_error: e.message, runs }) }
    finally { if (snap) await snap.dispose(); if (root) await rm(root, { recursive: true, force: true }) }
    if (signal?.aborted) break
  }
  const activated = packages.every(p => results.some(r => r.passed && r.runs?.every(x => x.kind === 'completed' && x.program === p.manifest.rule_id)))
  const proof = { validation_id, generation: s.generation, target: structuredClone(target), coverage, environment: environmentKey(s.config), suiteHash: hash(suite),
    passed: activated && results.length === suite.cases.length && results.every(r => r.passed), status: results.some(r => r.validation_error) ? 'validation_error' : activated && results.every(r => r.passed) && results.length === suite.cases.length ? 'ready' : 'rejected',
    results, durationMs: performance.now() - started, createdAt: new Date().toISOString() }
  await store.transaction(current => { current.proofs[validation_id] = proof; event(current, 'object-validation', proof) })
  return proof
}
