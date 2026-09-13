import { readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { Store, event } from './store.js'
import { assert } from './schema.js'
import { BACKEND, ruleConfig, environmentKey } from './rule-contract.js'
const initial = () => ({ backend: BACKEND, revision: 0, generation: 0, config: ruleConfig(), packages: {}, proofs: {}, active: {}, revoked: {}, sources: {}, events: [] })
// Reuse the existing fsync + atomic rename and exclusive lock implementation.
// Object state remains separate from legacy candidates and experiment logs.
export class RuleStore extends Store {
  constructor(root) { super(root); this.dir = join(this.root, '.dsh', 'executable-rules') }
  async exists() {
    try { await lstat(join(this.dir, 'state.json')); return true }
    catch (e) { if (e.code === 'ENOENT') return false; throw e }
  }
  async read() {
    await this.init()
    try {
      const file = join(this.dir, 'state.json'), st = await lstat(file)
      assert(st.isFile() && !st.isSymbolicLink(), 'Invalid rule state file')
      const s = JSON.parse(await readFile(file, 'utf8'))
      assert(s.backend === BACKEND && Number.isSafeInteger(s.revision) && Number.isSafeInteger(s.generation) && s.packages && s.proofs && s.active && s.revoked && s.sources && Array.isArray(s.events), 'Corrupt rule registry')
      s.config = ruleConfig(s.config); return s
    } catch (e) { if (e.code === 'ENOENT') return initial(); throw e }
  }
  async configure(patch) {
    return this.transaction(s => {
      const c = ruleConfig({ ...s.config, ...patch })
      if (environmentKey(c) !== environmentKey(s.config)) { s.generation++; s.active = {} }
      s.config = c; event(s, 'object-configure', { config: c, generation: s.generation }); return c
    })
  }
}
