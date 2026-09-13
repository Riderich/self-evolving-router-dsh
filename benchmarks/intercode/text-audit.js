// Corpus-level string statistics, not a semantic opportunity estimate.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { sourceCommit } from './protocol.js'
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const datasets = [], groups = new Map()
for (let fs = 1; fs <= 4; fs++) {
  const path = join(workspace, `vendor/intercode-${sourceCommit}/data/nl2bash/nl2bash_fs_${fs}.json`)
  const raw = await readFile(path), rows = JSON.parse(raw)
  datasets.push({ fs, path, count: rows.length, sha256: createHash('sha256').update(raw).digest('hex') })
  rows.forEach((row, index) => { const ids = groups.get(row.query) ?? []; ids.push({ fs, index }); groups.set(row.query, ids) })
}
const total = datasets.reduce((n, d) => n + d.count, 0)
const report = { time: new Date().toISOString(), sourceCommit, datasets, total, distinctQueries: groups.size, exactRepeatOccurrences: total - groups.size,
  duplicateGroups: [...groups].filter(([, ids]) => ids.length > 1).map(([query, ids]) => ({ query, ids })),
  scope: 'Original 200 query strings, byte-for-byte JS string equality; no normalization, semantic grouping or oracle labels. Not chronological traffic or a sealed audit.' }
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report, null, 2))
