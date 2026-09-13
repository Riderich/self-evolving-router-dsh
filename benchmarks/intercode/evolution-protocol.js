import { selected, fixtureFiles, expected, programs } from './protocol.js'

export function evolutionStream(data) {
  const original = [20, 22, 28, 40, 56].map(index => ({ ...selected.find(t => t.index === index), query: data[index].query, split: 'original-development' }))
  const probes = [[40, 'c'], [56, 'php'], [40, 'java']].map(([index, extension], i) => {
    const base = original.find(t => t.index === index)
    return { ...base, index: `probe-${i + 1}`, sourceIndex: index, extension, query: base.query.replace(base.extension, extension), split: 'synthetic-reuse-probe' }
  })
  return [...original, ...probes]
}
export function pastTemplates(rows) {
  return [...new Set(rows.map(t => t.query.replace(t.extension, '{extension}')))]
}
export function templateCandidate(data, rows, history, parent = null) {
  return { ...programs(data).find(p => p.id === 'recursive-lines'), description: 'Known-family parameter-template control; fixed hand-written executor',
    parent, templates: pastTemplates(rows), sourceIds: history.slice(0, 2).map(h => h.id) }
}
export function evolutionSuite(data) {
  const prefix = evolutionStream(data).slice(0, 3)
  const cases = fixtureFiles.flatMap((files, i) => prefix.map(t => ({ id: `prefix-${i}-${t.index}`, programId: 'recursive-lines', request: t.query, files,
    route: true, expected: { stdout: expected(t, files), exitCode: 0 } })))
  for (const request of ['Count nonempty lines in all php files in /testbed recursively', 'Count lines in top-level php files only in /testbed', 'Delete all php files in /testbed', 'Count lines in /etc/passwd']) {
    cases.push({ id: `boundary-${cases.length}`, programId: 'recursive-lines', request, files: {}, route: false })
  }
  return { version: 1, programs: [{ id: 'recursive-lines', description: 'Sum newline bytes across ordinary files of a requested extension recursively under /testbed. Output one integer and newline only. Empty matches return 0. Supported scope excludes hidden files and symlinks. Do not count nonempty lines or restrict to top level.' }], cases }
}
