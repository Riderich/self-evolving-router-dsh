import { checkHistoryEvidence } from './rule-history.js'
import { assert, object } from './schema.js'
import { readPackage, checkPackage } from './rule-package.js'
import { id, hash, environmentKey, revision } from './rule-contract.js'
import { loadRuleSuite, validateCollection } from './rule-validation.js'
import { event } from './store.js'
export class RuleRegistry {
  constructor(store, options = {}) { this.store = store; this.options = options }
  async addSource(source_id, evidence) {
    assert(typeof source_id === 'string' && source_id.length > 0 && source_id.length <= 200, 'Invalid source ID')
    assert(object(evidence) && ['manual-control', 'oracle-verified-history'].includes(evidence.kind) && typeof evidence.reference === 'string' && evidence.reference.length > 0, 'Trusted provenance required')
    return this.store.transaction(s => {
      assert(!s.sources[source_id] || hash(s.sources[source_id]) === hash(evidence), 'Source ID already bound')
      s.sources[source_id] = structuredClone(evidence); event(s, 'object-source', { source_id, evidence }); return source_id
    })
  }
  async submit(directory) {
    const pkg = await readPackage(directory)
    return this.store.transaction(s => {
      assert(pkg.manifest.source_ids.every(x => Object.hasOwn(s.sources, x)), 'Unknown trusted provenance')
      const parent = pkg.manifest.parent_revision
      assert(parent === null || s.packages[parent] && JSON.parse(s.packages[parent].files['manifest.json']).rule_id === pkg.manifest.rule_id, 'Invalid parent lineage')
      if (!s.packages[pkg.revision]) {
        assert(Object.keys(s.packages).length < 1000, 'Registry package limit')
        s.packages[pkg.revision] = { files: pkg.files, createdAt: new Date().toISOString(), source_ids: pkg.manifest.source_ids, parent_revision: parent }
        event(s, 'object-submit', { rule_id: pkg.manifest.rule_id, revision: pkg.revision, parent_revision: parent, source_ids: pkg.manifest.source_ids })
      }
      return { rule_id: pkg.manifest.rule_id, revision: pkg.revision, generation: s.generation }
    })
  }
  async validate(rev, signal) {
    const s = await this.store.read(); assert(revision(rev) && s.packages[rev], 'Unknown revision')
    const pkg = checkPackage({ files: s.packages[rev].files, revision: rev })
    const target = Object.fromEntries(Object.entries(s.active).map(([k, v]) => [k, v.revision])); target[pkg.manifest.rule_id] = rev
    return validateCollection(this.store, target, { ...this.options, signal, expectedGeneration: s.generation })
  }
  async activate(validation_id, expectedGeneration) {
    const suiteHash = hash(await loadRuleSuite(this.store))
    return this.store.transaction(s => {
      const proof = s.proofs[validation_id]
      assert(s.config.enabled && Number.isSafeInteger(expectedGeneration) && s.generation === expectedGeneration && proof?.generation === expectedGeneration, 'Stale registry generation')
      assert(proof.passed && proof.status === 'ready' && proof.suiteHash === suiteHash && proof.environment === environmentKey(s.config), 'No current passing validation')
      checkHistoryEvidence(s,proof)
      checkTarget(proof.target, s)
      const collectionHash = hash(proof.target)
      s.active = Object.fromEntries(Object.entries(proof.target).map(([k, rev]) => [k, { revision: rev, validation_id, collectionHash }]))
      s.generation++; event(s, 'object-activate', { validation_id, generation: s.generation, target: proof.target }); return { generation: s.generation, active: s.active }
    })
  }
  async disable(rule_id, expectedGeneration, { revoke = false } = {}) {
    assert(id(rule_id), 'Invalid rule ID')
    return this.store.transaction(s => {
      assert(s.generation === expectedGeneration && s.active[rule_id], 'Stale generation or inactive rule')
      const old = s.active[rule_id].revision
      if (revoke) s.revoked[old] = { at: new Date().toISOString(), reason: 'operator-revocation' }
      delete s.active[rule_id]; s.generation++
      // Remaining entries retain their evidence but fail the collection digest
      // check until the reduced collection is independently revalidated.
      event(s, 'object-disable', { rule_id, revision: old, revoke, generation: s.generation })
      return { generation: s.generation, requires_collection_revalidation: Object.keys(s.active).length > 0 }
    })
  }
  async rollback(rule_id, rev, expectedGeneration, signal) {
    const s = await this.store.read()
    assert(s.generation === expectedGeneration && revision(rev) && s.packages[rev] && !s.revoked[rev], 'Stale or revoked rollback target')
    assert(JSON.parse(s.packages[rev].files['manifest.json']).rule_id === rule_id, 'Wrong rollback identity')
    const proof = await this.validate(rev, signal)
    assert(proof.passed, 'Rollback target failed current validation')
    return this.activate(proof.validation_id, expectedGeneration)
  }
}
function checkTarget(target, s) {
  for (const [rule_id, rev] of Object.entries(target)) {
    assert(!s.revoked[rev] && s.packages[rev], 'Revoked/missing target')
    const pkg = checkPackage({ files: s.packages[rev].files, revision: rev }); assert(pkg.manifest.rule_id === rule_id, 'Target identity changed')
  }
  return target
}
