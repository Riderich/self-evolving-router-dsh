// Explicit bounded paid-provider development run. Not included in tests.
import { mkdtemp, readFile, writeFile, cp, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Router } from '../../lib/runtime.js'
import { metrics } from '../../lib/metrics.js'
import { selected, image, sourceCommit, inventory, fingerprint, expected, programs, evaluationSuite } from './protocol.js'
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const authPath = await realpath(process.argv[2]), source = await realpath(process.argv[3])
const auth = JSON.parse(await readFile(authPath, 'utf8'))
const sourceView = await inventory(source)
const data = JSON.parse(await readFile(join(workspace, `vendor/intercode-${sourceCommit}/data/nl2bash/nl2bash_fs_1.json`)))
const tasks = [0, 20, 33].map(index => selected.find(t => t.index === index))
const output = await mkdtemp(join(workspace, 'results/DSH_INTERCODE_COMPARE_')), journal = join(output, 'network.jsonl')
await writeFile(journal, '', { mode: 0o600 })
const report = { started: new Date().toISOString(), source, sourceCommit, image, sourceFingerprint: fingerprint(sourceView), model: auth.model ?? 'deepseek-v4-flash',
  endpoint: auth.baseURL, conditions: ['B0-always-LLM', 'B1-static-manual'], taskIndices: tasks.map(t => t.index), maxHTTPCalls: 12,
  split: 'three manually selected development tasks; not full benchmark or evolution comparison', runs: [], setup: {} }
const redact = s => String(s).replaceAll(auth.apiKey, '[REDACTED]')
const checkpoint = () => writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2)), { mode: 0o600 })
const requests = async () => (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(e => e.type === 'request').length
const routers = {}
async function launch(root, config, query) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', fileURLToPath(new URL('../../scripts/acceptance-network.js', import.meta.url)), fileURLToPath(new URL('../../run.js', import.meta.url)), '--auth-file', authPath, '--benchmark-file', config, query],
      { cwd: root, env: { ...process.env, ROUTER_ACCEPTANCE_AUTH: authPath, ROUTER_ACCEPTANCE_JOURNAL: journal }, stdio: ['ignore', 'pipe', 'pipe'] })
    const start = performance.now(); let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL') }, 90000)
    p.stdout.on('data', b => { stdout = (stdout + b).slice(-100000) }); p.stderr.on('data', b => { stderr = (stderr + b).slice(-100000) })
    p.on('error', reject); p.on('close', code => { clearTimeout(timer); resolve({ code, timedOut, stdout: redact(stdout), stderr: redact(stderr), wallMs: performance.now() - start }) })
  })
}
console.log(JSON.stringify({ output, model: report.model, maxHTTPCalls: 12 }))
try {
  for (const condition of report.conditions) {
    const start = performance.now(), root = join(output, condition), toolJournal = join(output, `${condition}-tools.jsonl`), configPath = join(output, `${condition}-backend.json`)
    await mkdir(root); await cp(source, root, { recursive: true })
    const router = new Router(root); routers[condition] = router
    await router.store.configure({ enabled: true, learning: false, image, dockerContext: 'colima', snapshotDirectory: fileURLToPath(new URL('../../.sandbox', import.meta.url)) })
    const candidates = programs(data).filter(c => tasks.some(t => t.family === c.id))
    await writeFile(join(router.store.dir, 'evals.json'), JSON.stringify(evaluationSuite(data, candidates)))
    await writeFile(configPath, JSON.stringify({ root, image, journal: toolJournal }))
    if (condition === 'B1-static-manual') {
      // Explicit artificial fixture provenance, not claimed as observed model history.
      await router.store.transaction(s => { s.history = ['manual-fixture-a', 'manual-fixture-b'].map(id => ({ id, evidence: 'manual-independent-fixture', request: 'Static-control admission fixture', output: '', time: new Date().toISOString() })) })
      for (const candidate of candidates) { const admission = await router.admit(candidate); if (!admission.proof.passed) throw Error(`Static admission failed: ${candidate.id}`) }
    }
    report.setup[condition] = { root, configPath, toolJournal, wallMs: performance.now() - start, state: await router.store.read() }; await checkpoint()
  }
  for (const task of tasks) for (const condition of report.conditions) {
    const router = routers[condition], setup = report.setup[condition], before = await requests()
    const run = await launch(setup.root, setup.configPath, data[task.index].query)
    const state = await router.store.read(), turn = state.events.filter(e => e.type === 'agent-turn').at(-1)
    const oracle = expected(task, sourceView.files)
    const row = { condition, index: task.index, query: data[task.index].query, oracle, ...run, httpRequests: await requests() - before, turn,
      answerCorrect: run.code === 0 && run.stdout.trim() === oracle.trim(), answerComparison: 'exact after trimming boundary whitespace in BOTH conditions' }
    report.runs.push(row)
    await writeFile(join(output, `${condition}-${task.index}-state.json`), redact(JSON.stringify(state, null, 2)), { mode: 0o600 })
    // Exclude router-private state when checking the public fixture.
    const { snapshot } = await import('../../lib/executor.js')
    const publicCopy = await snapshot(setup.root, fileURLToPath(new URL('../../.sandbox', import.meta.url)))
    try { row.sourceUnchanged = fingerprint(await inventory(publicCopy)) === report.sourceFingerprint }
    finally { const { rm } = await import('node:fs/promises'); await rm(publicCopy, { recursive: true, force: true }) }
    await checkpoint(); console.log(JSON.stringify({ condition, index: task.index, code: run.code, correct: row.answerCorrect, httpRequests: row.httpRequests, wallMs: run.wallMs }))
    if (run.code !== 0 || !row.sourceUnchanged) throw Error('Execution or fixture-integrity failure; stopping bounded run')
    if (condition === 'B1-static-manual' && (row.httpRequests !== 0 || !turn?.routed)) throw Error('Static branch unexpectedly called model or did not route')
  }
  report.passed = report.runs.every(r => r.answerCorrect)
  if (!report.passed) process.exitCode = 1
} catch (error) { report.passed = false; report.error = redact(error.message); process.exitCode = 1 }
finally {
  report.finished = new Date().toISOString(); report.httpRequests = await requests(); report.metrics = {}
  for (const [condition, router] of Object.entries(routers)) report.metrics[condition] = metrics(await router.store.read())
  await checkpoint(); console.log(JSON.stringify({ output, passed: report.passed, error: report.error, httpRequests: report.httpRequests, metrics: report.metrics }))
}
