import { mkdir, lstat, realpath, readFile, open, rename, unlink } from 'node:fs/promises'
import { join, resolve, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assert, defaults, validateConfig } from './schema.js'

const initial = () => ({ version: 1, revision: 0, config: { ...defaults }, history: [], candidates: {}, active: {}, previous: {}, stats: {}, budget: {}, events: [] })
export class Store {
  constructor(root) { this.root = resolve(root); this.dir = join(this.root, '.dsh', 'prellm-router') }
  async init() {
    assert(this.root !== parse(this.root).root, 'A filesystem root cannot be a router workspace')
    assert(await realpath(this.root) === this.root, 'Workspace must use its canonical, non-symlink path')
    for (const p of [join(this.root, '.dsh'), this.dir]) {
      try { await mkdir(p, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
      const s = await lstat(p); assert(s.isDirectory() && !s.isSymbolicLink(), 'Router state must not cross symlinks')
    }
  }
  async read() {
    await this.init()
    const file = join(this.dir, 'state.json')
    try {
      assert((await lstat(file)).isFile(), 'State must be a regular file')
      assert(!(await lstat(file)).isSymbolicLink(), 'State symlink rejected')
      const state = JSON.parse(await readFile(file, 'utf8'))
      assert(state.version === 1 && Number.isSafeInteger(state.revision) && Array.isArray(state.history) && state.candidates && state.active && state.stats && state.previous && state.budget && Array.isArray(state.events), 'Corrupt router state')
      state.config = validateConfig(state.config)
      return state
    } catch (e) { if (e.code === 'ENOENT') return initial(); throw e }
  }
  async transaction(fn) {
    await this.init()
    const lock = join(this.dir, 'state.lock')
    let handle
    const deadline = Date.now() + 10000
    while (!handle) {
      try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() })) }
      catch (e) {
        if (e.code !== 'EEXIST') throw e
        try {
          const s = await lstat(lock); assert(s.isFile() && !s.isSymbolicLink(), 'Unsafe lock')
          const contents = await readFile(lock, 'utf8')
          if (!contents) { await new Promise(r => setTimeout(r, 25)); continue }
          const owner = JSON.parse(contents)
          assert(Number.isInteger(owner.pid) && owner.pid > 0, 'Invalid lock owner')
          let alive = true
          try { process.kill(owner.pid, 0) } catch (x) { alive = x.code !== 'ESRCH' }
          if (!alive && Date.now() - s.mtimeMs > 1000) { await unlink(lock); continue }
        } catch (x) { if (x.code !== 'ENOENT') throw x }
        assert(Date.now() < deadline, 'Router state is busy')
        await new Promise(r => setTimeout(r, 25))
      }
    }
    let temporary
    try {
      const s = await this.read()
      const result = await fn(s)
      s.revision++
      temporary = join(this.dir, `state.${randomUUID()}.tmp`)
      const out = await open(temporary, 'wx', 0o600)
      try { await out.writeFile(JSON.stringify(s)); await out.sync() } finally { await out.close() }
      await rename(temporary, join(this.dir, 'state.json'))
      return result
    } finally {
      if (temporary) await unlink(temporary).catch(() => {})
      await handle.close(); await unlink(lock)
    }
  }
  async configure(patch) { return this.transaction(s => { s.config = validateConfig({ ...s.config, ...patch }); event(s, 'configure', { keys: Object.keys(patch) }); return s.config }) }
}
export function event(s, type, data = {}) {
  s.events.push({ id: randomUUID(), time: new Date().toISOString(), type, ...data })
  // Retain lifecycle evidence. Export/archival is explicit, never silently lossy.
}
