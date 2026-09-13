import { readdir, readFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
let checked = 0
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (/\.(js|mjs)$/.test(e.name)) { const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' }); if (r.status !== 0) throw Error(r.stderr); checked++ }
  }
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const p of [...pkg.files, ...Object.values(pkg.bin)]) await access(join(root, p))
await walk(root); console.log(`Syntax and package entry checks passed (${checked} JS files)`)
