import { checkHistoryEvidence } from './rule-history.js'
import { randomUUID } from 'node:crypto'
import { assert, requestVeto, sensitive } from './schema.js'
import { RuleStore } from './rule-store.js'
import { RuleWorker, requestSnapshot } from './rule-worker.js'
import { checkPackage } from './rule-package.js'
import { hash, environmentKey, BACKEND } from './rule-contract.js'
import { event } from './store.js'
export async function evaluateRules(packages, request, config, snap, worker, signal, beforeExecute = async () => {}) {
  const triggers = []; let selected
  for (const pkg of [...packages].sort((a, b) => a.manifest.rule_id.localeCompare(b.manifest.rule_id))) {
    signal?.throwIfAborted()
    try {
      const output = await worker.run(pkg, 'trigger', { request, context: { backend: BACKEND, snapshot_id: snap.id, capabilities: ['public-workspace-read'] } }, config, undefined, signal)
      triggers.push({ rule_id: pkg.manifest.rule_id, revision: pkg.revision, ...output })
    } catch (e) { triggers.push({ rule_id: pkg.manifest.rule_id, revision: pkg.revision, error: e.message, ...e.telemetry }); return { kind: 'fallback', reason: 'trigger-error', triggers } }
  }
  if (triggers.some(t => t.result.decision === 'abstain')) return { kind: 'fallback', reason: 'trigger-abstain', triggers }
  const matches = triggers.filter(t => t.result.decision === 'match')
  if (matches.length !== 1) return { kind: 'fallback', reason: matches.length ? 'conflict' : 'unmatched', triggers }
  selected = packages.find(p => p.revision === matches[0].revision)
  let execution
  try {
    signal?.throwIfAborted(); await beforeExecute(selected)
    execution = await worker.run(selected, 'executor', { request, args: matches[0].result.args, context: { backend: BACKEND, snapshot_id: snap.id, root: '/testbed' } }, config, snap, signal)
    signal?.throwIfAborted()
    if (execution.result.status === 'fallback') return { kind: 'fallback', reason: execution.result.reason_code, triggers, execution }
    assert(!sensitive(execution.result.result.text), 'Sensitive output rejected')
    return { kind: 'completed', text: execution.result.result.text, program: selected.manifest.rule_id, hash: selected.revision, triggers, execution }
  } catch (e) { return { kind: 'fallback', reason: 'execution-error', detail: e.message, triggers, execution: execution ?? e.telemetry ?? null } }
}
export function activePackages(s, suiteHash) {
  const entries = Object.entries(s.active)
  assert(entries.length <= s.config.maxRules, 'Registry exceeds rule limit')
  return entries.map(([id, activation]) => {
    const row = s.packages[activation.revision], proof = s.proofs[activation.validation_id]
    assert(row && !s.revoked[activation.revision] && proof?.passed && proof.suiteHash === suiteHash && proof.environment === environmentKey(s.config), 'Stale or revoked activation')
    assert(proof.target[id] === activation.revision && hash(proof.target) === activation.collectionHash, 'Invalid collection activation')
    assert(hash(Object.fromEntries(entries.map(([k, v]) => [k, v.revision]))) === activation.collectionHash, 'Collection changed since validation')
    checkHistoryEvidence(s,proof)
    const pkg = checkPackage({ files: row.files, revision: activation.revision }); assert(pkg.manifest.rule_id === id, 'Rule identity mismatch'); return pkg
  })
}
export class ObjectRouter {
  constructor(root, { worker = new RuleWorker() } = {}) { this.store = new RuleStore(root); this.worker = worker }
  async route(request, signal) {
    const started = performance.now(), request_id = randomUUID(); let snap, result, s
    try {
      s = await this.store.read()
      if (!s.config.enabled || requestVeto(request)) result = { kind: 'fallback', reason: 'disabled-or-veto' }
      else {
        const { loadRuleSuite } = await import('./rule-validation.js')
        const suiteHash = hash(await loadRuleSuite(this.store))
        const packages = activePackages(s, suiteHash)
        if (!packages.length) result = { kind: 'fallback', reason: 'unmatched', triggers: [] }
        else {
          const deadline = AbortSignal.timeout(s.config.routeTimeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline
          snap = await requestSnapshot(this.store.root, s.config, combined)
          const checkCurrent = async () => {
            const current = await this.store.read()
            assert(current.config.enabled && current.generation === s.generation && environmentKey(current.config) === environmentKey(s.config), 'Registry changed')
            assert(hash(await loadRuleSuite(this.store)) === suiteHash, 'Suite changed')
            activePackages(current, suiteHash)
          }
          result = await evaluateRules(packages, request, s.config, snap, this.worker, combined, checkCurrent)
          if (result.kind === 'completed') { await checkCurrent(); combined.throwIfAborted() }
        }
      }
    } catch (e) { result = { ...result, kind: 'fallback', text: undefined, reason: 'object-router-unavailable', detail: e.message } }
    finally { if (snap) await snap.dispose().catch(() => {}) }
    result = { ...result, backend: BACKEND, request_id, snapshot_id: snap?.id ?? null, modelCalls: 0, durationMs: performance.now() - started }
    const recordedRequest = typeof request !== 'string' ? '[invalid-request]' : sensitive(request) ? '[redacted-sensitive-request]' : request.slice(0, 4096)
    try { await this.store.transaction(current => event(current, 'object-route', { request: recordedRequest, generation: s?.generation, ...result })) }
    catch { return { ...result, kind: 'fallback', reason: 'event-storage-unavailable', text: undefined } }
    return { ...result, durationMs: performance.now() - started }
  }
}
