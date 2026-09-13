import { mkdtemp, realpath, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Router } from '../lib/runtime.js'
export const image = 'sha256:2260313b31c8c011cd2eebe728008efac1b3982be73eb71348ea2648d2c0e09b'
export const candidate = (ids = ['one', 'two']) => ({
  id: 'list-files', description: 'List visible entries of the public workspace snapshot',
  parent: null, templates: ['list visible files'], parameters: [],
  script: '#!/bin/sh\nLC_ALL=C ls -1 /testbed', requires: ['ls'], sourceIds: ids,
})
export const suite = { version: 1, cases: [
  { id: 'one', programId: 'list-files', request: 'list visible files', route: true, files: { 'a.txt': 'x' }, expected: { stdout: 'a.txt\n', exitCode: 0 } },
  { id: 'two', programId: 'list-files', request: 'list visible files', route: true, files: { 'b.txt': 'y' }, expected: { stdout: 'b.txt\n', exitCode: 0 } },
  { id: 'three', programId: 'list-files', request: 'list hidden files', route: false, files: {} },
  { id: 'four', programId: 'list-files', request: 'delete visible files', route: false, files: {} },
] }
export async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'router-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const router = new Router(root, options)
  await router.store.configure({ enabled: true, image, dockerContext: 'colima', snapshotDirectory: fileURLToPath(new URL('../.sandbox', import.meta.url)) })
  await writeFile(join(router.store.dir, 'evals.json'), JSON.stringify(suite))
  await router.record({ request: 'list visible files', output: 'a.txt' })
  await router.record({ request: 'list visible files', output: 'b.txt' })
  const ids = (await router.store.read()).history.map(h => h.id)
  return { router, root, candidate: candidate(ids) }
}
export const fakeExecutor = { async execute(c, args, root) {
  return { stdout: (await readdir(root)).filter(x => !x.startsWith('.')).sort().map(x => x + '\n').join(''), stderr: '', exitCode: 0, durationMs: 1 }
} }
