import { constants } from 'node:fs'
import { open, readdir, lstat, realpath, mkdir, writeFile, mkdtemp, chmod, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { assert } from './schema.js'
import { manifest, hash, keys, revision } from './rule-contract.js'
export function packagePath(p) { return typeof p === 'string' && p.length <= 200 && p.split('/').every(x => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(x) && x !== '.' && x !== '..') && /\.(py|json|md|txt)$/.test(p) }
export function checkPackage(pkg) {
  keys(pkg, ['files', 'revision'], 'package')
  assert(pkg.files && typeof pkg.files === 'object' && !Array.isArray(pkg.files), 'Invalid package files')
  const entries = Object.entries(pkg.files)
  assert(entries.length >= 4 && entries.length <= 64, 'Invalid package file count')
  let size = 0
  for (const [p, content] of entries) { assert(packagePath(p) && typeof content === 'string' && !content.includes('\0'), 'Invalid package file'); size += Buffer.byteLength(content) }
  assert(size <= 256 * 1024, 'Package exceeds 256 KiB')
  for (const p of ['manifest.json', 'README.md', 'trigger.py', 'executor.py']) assert(Object.hasOwn(pkg.files, p), `Missing ${p}`)
  const m = manifest(JSON.parse(pkg.files['manifest.json']))
  const calculated = hash(pkg.files)
  if (pkg.revision !== undefined) assert(revision(pkg.revision) && pkg.revision === calculated, 'Package digest mismatch')
  return { files: structuredClone(pkg.files), revision: calculated, manifest: m }
}
export async function readPackage(directory) {
  const root = resolve(directory)
  assert(await realpath(root) === root && (await lstat(root)).isDirectory(), 'Canonical package directory required')
  const files = {}; let bytes = 0, count = 0
  async function walk(dir, prefix = '', depth = 0) {
    assert(depth <= 8, 'Package tree too deep')
    for (const name of (await readdir(dir)).sort()) {
      const relative = prefix + name, p = join(dir, name), st = await lstat(p)
      assert(++count <= 96 && !st.isSymbolicLink(), 'Package links or too many entries')
      if (st.isDirectory()) { assert(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name), 'Invalid directory'); await walk(p, relative + '/', depth + 1) }
      else {
        assert(st.isFile() && packagePath(relative) && st.nlink === 1 && st.size <= 256 * 1024, 'Invalid package path/type/size')
        const file = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const actual = await file.stat(); assert(actual.isFile() && actual.ino === st.ino && actual.size <= 256 * 1024, 'Package changed during read')
          const content = await file.readFile(); bytes += content.length; assert(bytes <= 256 * 1024, 'Package too large')
          files[relative] = new TextDecoder('utf-8', { fatal: true }).decode(content)
        } finally { await file.close() }
      }
    }
  }
  await walk(root)
  return checkPackage({ files })
}
export async function materializePackage(pkg, directory) {
  const checked = checkPackage({ files: pkg.files, revision: pkg.revision })
  await mkdir(directory, { recursive: true })
  const dest = await mkdtemp(join(directory, 'rule-package-')); await chmod(dest, 0o755)
  try {
    for (const [p, content] of Object.entries(checked.files)) {
      await mkdir(dirname(join(dest, p)), { recursive: true, mode: 0o755 })
      await writeFile(join(dest, p), content, { flag: 'wx', mode: 0o444 })
    }
    return { path: dest, dispose: () => rm(dest, { recursive: true, force: true }) }
  } catch (e) { await rm(dest, { recursive: true, force: true }); throw e }
}
