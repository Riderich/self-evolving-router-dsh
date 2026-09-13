// Development-only protocol. Original requests are never silently rewritten.
import { createHash } from 'node:crypto'
import { readdir, readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
export const revision = 'intercode-fs1-readonly-dev-v1'
export const sourceCommit = 'c3e46d827cfc9d4c704ec078f7abf9f41e3191d8'
export const image = 'sha256:35c6490d6660dc10de870484cb709126fd245bbf05a315c8632563d69b0f3430'
export const selected = [
  { index: 0, family: 'duplicate-md5', eligible: true, reason: '顶层 .java 内容摘要的重复集合', oracle: 'duplicate-md5' },
  { index: 17, family: 'prefix-hex', eligible: true, reason: '前 16 字节；原夹具为 ASCII，不能推广成 Unicode 字符契约', oracle: 'prefix-hex' },
  { index: 20, family: 'recursive-lines', eligible: true, reason: '递归 .c 文件换行符总数', oracle: 'lines', extension: 'c' },
  { index: 22, family: 'recursive-lines', eligible: true, reason: '递归 .php 文件换行符总数', oracle: 'lines', extension: 'php' },
  { index: 28, family: 'recursive-lines', eligible: true, reason: '递归 .php 文件换行符总数', oracle: 'lines', extension: 'php' },
  { index: 33, family: 'file-count', eligible: true, reason: '递归普通文件数量', oracle: 'file-count' },
  { index: 40, family: 'recursive-lines', eligible: true, reason: '递归 .php 文件换行符总数', oracle: 'lines', extension: 'php' },
  { index: 53, family: 'duplicate-names', eligible: true, reason: '不区分大小写的重复 basename；输出大小写取首项', oracle: 'duplicate-names' },
  { index: 56, family: 'recursive-lines', eligible: true, reason: '递归 .java 换行符总数；原 gold 对单文件无 total 行，需独立 oracle', oracle: 'lines', extension: 'java' },
  { index: 8, family: 'mutation', eligible: false, reason: 'chmod 写操作，必须回退，禁止执行其 gold' },
  { index: 15, family: 'mutation-and-gold-mismatch', eligible: false, reason: '复制写操作且 query 限 dir1、gold 搜索整个 testbed' },
  { index: 23, family: 'nonempty-lines', eligible: false, reason: '非空行而非全部换行符，不可复用 total-lines 程序；gold 多文件 grep 前缀可能破坏 awk 求和' },
  { index: 39, family: 'nonempty-lines', eligible: false, reason: '非空行请求不能命中普通行数程序；不是断言该任务不能程序化' },
  { index: 58, family: 'permission-metadata', eligible: false, reason: '快照重置权限，且 gold 缺 sticky-bit 判断' },
]
export async function inventory(root) {
  const files = {}, directories = []
  async function walk(base, prefix = '') {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = prefix + entry.name, absolute = join(base, entry.name), stat = await lstat(absolute)
      if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name) || stat.isSymbolicLink()) throw Error(`Snapshot-incompatible fixture: ${path}`)
      if (stat.isDirectory()) { directories.push(path); await walk(absolute, path + '/') }
      else if (stat.isFile()) files[path] = await readFile(absolute)
      else throw Error(`Unsupported fixture entry: ${path}`)
    }
  }
  await walk(root)
  return { files, directories: directories.sort() }
}
export function fingerprint(view) {
  return createHash('sha256').update(JSON.stringify({ directories: view.directories, files: Object.entries(view.files).sort(([a], [b]) => a.localeCompare(b)).map(([p, b]) => [p, createHash('sha256').update(b).digest('hex')]) })).digest('hex')
}
export function expected(task, files) {
  const entries = Object.entries(files)
  if (task.oracle === 'lines') return String(entries.filter(([p]) => p.endsWith('.' + task.extension)).reduce((n, [, b]) => n + [...Buffer.from(b)].filter(x => x === 10).length, 0)) + '\n'
  if (task.oracle === 'file-count') return entries.length + '\n'
  if (task.oracle === 'prefix-hex') { if (!files['textfile7.txt']) throw Error('Missing textfile7.txt'); return Buffer.from(files['textfile7.txt']).subarray(0, 16).toString('hex') + '\n' }
  if (task.oracle === 'duplicate-md5') {
    const counts = new Map()
    for (const [p, b] of entries) if (!p.includes('/') && p.endsWith('.java')) { const hash = createHash('md5').update(b).digest('hex'); counts.set(hash, (counts.get(hash) ?? 0) + 1) }
    return [...counts].filter(([, n]) => n > 1).map(([h]) => h).sort().map(h => h + '\n').join('')
  }
  if (task.oracle === 'duplicate-names') {
    const groups = new Map()
    for (const [p] of entries) { const name = p.split('/').at(-1); if (!/^[\x20-\x7e]+$/.test(name)) throw Error('Non-ASCII name requires a different oracle'); const key = name.toLowerCase(); const group = groups.get(key) ?? []; group.push(name); groups.set(key, group) }
    return [...groups].filter(([, v]) => v.length > 1).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, names]) => names.sort()[0] + '\n').join('')
  }
  throw Error('No approved oracle')
}
export function programs(data) {
  const definitions = [
    ['recursive-lines', selected.filter(t => t.oracle === 'lines'), ['find', 'cat', 'wc'], '#!/bin/sh\nfind /testbed -type f -name "*.$1" -exec cat -- {} + > /tmp/router-lines\nwc -l < /tmp/router-lines'],
    ['duplicate-md5', selected.filter(t => t.oracle === 'duplicate-md5'), ['md5sum', 'awk', 'sort', 'uniq'], '#!/bin/sh\nmd5sum /testbed/*.java > /tmp/router-hashes\nawk \'{print $1}\' /tmp/router-hashes | LC_ALL=C sort | uniq -d'],
    ['prefix-hex', selected.filter(t => t.oracle === 'prefix-hex'), ['head', 'od', 'tr'], '#!/bin/sh\nhead -c16 /testbed/textfile7.txt > /tmp/router-prefix\nod -An -tx1 -v /tmp/router-prefix | tr -d " \\n"\nprintf "\\n"'],
    ['file-count', selected.filter(t => t.oracle === 'file-count'), ['find', 'wc'], '#!/bin/sh\nfind /testbed -type f -printf x > /tmp/router-files\nwc -c < /tmp/router-files'],
    ['duplicate-names', selected.filter(t => t.oracle === 'duplicate-names'), ['find', 'sort', 'uniq'], '#!/bin/sh\nfind /testbed -type f -printf "%f\\n" > /tmp/router-names\nLC_ALL=C sort -f /tmp/router-names | LC_ALL=C uniq -i -d'],
  ]
  return definitions.map(([id, tasks, requires, script]) => ({ id, description: 'Static handwritten development control: ' + id, parent: null,
    templates: [...new Set(tasks.map(t => t.oracle === 'lines' ? data[t.index].query.replace(t.extension, '{extension}') : data[t.index].query))],
    parameters: id === 'recursive-lines' ? [{ name: 'extension', type: 'enum', values: ['c', 'php', 'java'] }] : [], requires, script,
    sourceIds: ['manual-fixture-a', 'manual-fixture-b'] }))
}
export const fixtureFiles = [
  { 'a.c': 'one\ntwo', 'b.php': '\n\n', 'X.java': 'same\n', 'Y.java': 'same\n', 'textfile7.txt': '0123456789abcdefXYZ', 'nested/a.c': 'three\n', 'nested/X.java': 'other\n' },
  { 'space name.c': '', 'empty.php': '', 'X.java': 'only\n', 'textfile7.txt': 'short', 'nested/empty.php': 'no newline', 'nested/name.txt': 'abc' },
]
export function evaluationSuite(data, candidates) {
  const cases = []
  for (const c of candidates) {
    const tasks = selected.filter(t => t.eligible && t.family === c.id)
    for (const [i, files] of fixtureFiles.entries()) for (const task of tasks) cases.push({ id: `${c.id}-${i}-${task.index}`, programId: c.id, request: data[task.index].query, files, route: true, expected: { stdout: expected(task, files), exitCode: 0 } })
    for (const t of selected.filter(t => !t.eligible)) cases.push({ id: `${c.id}-negative-${t.index}`, programId: c.id, request: data[t.index].query, files: {}, route: false })
  }
  return { version: 1, programs: candidates.map(c => ({ id: c.id, description: c.description })), cases }
}
export function score(task, result, oracle) {
  if (!task.eligible) return { correct: result.kind === 'fallback', taskSuccess: null, incorrectAutomation: result.kind === 'completed' }
  if (result.kind !== 'completed') return { correct: false, taskSuccess: null, incorrectAutomation: false }
  const correct = result.exitCode === 0 && result.stderr === '' && result.stdout === oracle
  return { correct, taskSuccess: correct, incorrectAutomation: !correct }
}
