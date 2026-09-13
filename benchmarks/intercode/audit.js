// No LLM calls. Read-only source-fixture, oracle and static-control acceptance.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { DockerExecutor } from '../../lib/executor.js'
import { bind } from '../../lib/matcher.js'
import { validate } from '../../lib/validation.js'
import { validateCandidate, validateConfig } from '../../lib/schema.js'
import { revision, sourceCommit, image, selected, inventory, fingerprint, expected, programs, evaluationSuite, score } from './protocol.js'

const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const dataPath = join(workspace, 'vendor', `intercode-${sourceCommit}`, 'data/nl2bash/nl2bash_fs_1.json')
const rawData = await readFile(dataPath), data = JSON.parse(rawData)
const output = await mkdtemp(join(workspace, 'results/INTERCODE_ROUTER_AUDIT_'))
const snapshotDirectory = fileURLToPath(new URL('../../.sandbox', import.meta.url))
await mkdir(snapshotDirectory, { recursive: true })
const config = validateConfig({ image, dockerContext: 'colima', snapshotDirectory })
const executor = new DockerExecutor(), candidates = programs(data).map(validateCandidate)
const suite = evaluationSuite(data, candidates)
await writeFile(join(output, 'evals.json'), JSON.stringify(suite, null, 2))
const report = { revision, started: new Date().toISOString(), sourceCommit, image, dataPath, datasetSHA256: createHash('sha256').update(rawData).digest('hex'),
  split: 'development-only; original dataset order, NOT timestamped user traffic', apiCalls: 0,
  audited: selected.map(t => ({ ...t, ...data[t.index] })), candidates, proofs: [], resets: [], executions: [] }
const checkpoint = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
async function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['--context', 'colima', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', failure
    const timer = setTimeout(() => { failure = Error('Docker management timeout'); child.kill('SIGKILL') }, 30000)
    child.stdout.on('data', b => { stdout += b }); child.stderr.on('data', b => { stderr += b })
    child.on('error', e => { failure = e })
    child.on('close', code => { clearTimeout(timer); failure || code !== 0 ? reject(failure ?? Error(stderr)) : resolve(stdout.trim()) })
  })
}
console.log(JSON.stringify({ output, stage: 'independent-validation', paidModelCalls: 0 }))
try {
  for (const c of candidates) {
    const proof = await validate(c, { dir: output }, executor, config)
    report.proofs.push({ id: c.id, proof }); await checkpoint()
    assert.equal(proof.passed, true, `Static candidate rejected: ${c.id}`)
  }
  for (let repetition = 0; repetition < 2; repetition++) {
    const root = join(output, `fs1-reset-${repetition}`), container = `dsh-router-audit-${randomUUID()}`
    await mkdir(root)
    try {
      await docker(['create', '--pull=never', '--name', container, '--network', 'none', '--read-only', '--cap-drop', 'ALL', image, '/bin/true'])
      await docker(['cp', `${container}:/testbed/.`, root])
    } finally { await docker(['rm', '-f', container]) }
    const view = await inventory(root)
    report.resets.push({ repetition, root, fingerprint: fingerprint(view), files: Object.keys(view.files).length, directories: view.directories.length })
    await checkpoint()
    for (const task of selected) {
      const request = data[task.index].query, started = performance.now()
      const matches = []
      for (const candidate of candidates) { const args = await bind(candidate, request, root); if (args) matches.push({ candidate, args }) }
      assert.ok(matches.length <= 1, 'Ambiguous static control')
      const oracle = task.eligible ? expected(task, view.files) : null
      let result = { kind: 'fallback' }, gold = null
      if (matches.length === 1) {
        assert.ok(task.eligible, 'Never execute an out-of-scope route')
        const { candidate, args } = matches[0]
        result = { kind: 'completed', ...await executor.execute(candidate, args, root, config) }
      }
      const routingMs = performance.now() - started
      // Audited read-only gold only, in the same immutable image and snapshot view.
      if (task.eligible) gold = await executor.execute({ requires: [], script: '#!/bin/sh\n' + data[task.index].gold }, [], root, config)
      const row = { repetition, index: task.index, request, family: task.family, oracle, result, routingMs, score: score(task, result, oracle), gold,
        goldMatchesOracle: gold ? gold.exitCode === 0 && gold.stderr === '' && gold.stdout === oracle : null }
      report.executions.push(row); await checkpoint()
      console.log(JSON.stringify({ repetition, index: task.index, kind: result.kind, correct: row.score.correct, goldMatchesOracle: row.goldMatchesOracle }))
    }
    assert.equal(fingerprint(await inventory(root)), fingerprint(view), 'Source fixture changed')
  }
  assert.equal(report.resets[0].fingerprint, report.resets[1].fingerprint, 'Reset not reproducible')
  const families = new Map(), seen = new Set()
  let exactRepeats = 0, laterFamilyRequests = 0, afterThreeHistoryRequests = 0
  for (const task of [...selected].sort((a, b) => a.index - b.index)) {
    const text = data[task.index].query
    if (seen.has(text)) exactRepeats++
    seen.add(text)
    if (!task.eligible) continue
    const n = families.get(task.family) ?? 0
    if (n > 0) laterFamilyRequests++
    if (n >= 3) afterThreeHistoryRequests++
    families.set(task.family, n + 1)
  }
  report.summary = { selectedTasks: selected.length, eligibleTasks: selected.filter(t => t.eligible).length, families: Object.fromEntries(families),
    exactRepeats, laterFamilyRequests, afterThreeHistoryRequests,
    correctStaticExecutions: report.executions.filter(r => r.result.kind === 'completed' && r.score.correct).length,
    incorrectAutomation: report.executions.filter(r => r.score.incorrectAutomation).length,
    correctAbstentions: report.executions.filter(r => r.result.kind === 'fallback' && r.score.correct).length,
    goldDisagreements: report.executions.filter(r => r.goldMatchesOracle === false).map(r => ({ repetition: r.repetition, index: r.index })),
    validationMs: report.proofs.reduce((n, p) => n + p.proof.durationMs, 0),
    staticRoutingMs: report.executions.reduce((n, r) => n + r.routingMs, 0),
    notes: ['Opportunity counts apply ONLY to these manually selected development tasks, not all 200 records.',
      'No repeated requests were injected; dataset order is not real chronological traffic.',
      'B1 is handwritten and sees selected request forms. B0/B2/B3/B4 are NOT run; zero exact repeats is a text statistic, not a cache benchmark.',
      'Gold stdout equality is independent of upstream TF-IDF reward. Metadata/write tasks remain unexecuted.',
      'No LLM tokens, cost savings, full DSH benchmark result or future generalization inferred.'] }
  report.passed = report.executions.every(r => r.score.correct && r.goldMatchesOracle !== false)
  if (!report.passed) process.exitCode = 1
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1 }
finally { report.finished = new Date().toISOString(); await checkpoint(); console.log(JSON.stringify({ output, passed: report.passed, error: report.error, summary: report.summary })) }
