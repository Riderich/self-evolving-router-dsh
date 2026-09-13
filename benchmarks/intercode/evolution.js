// Explicit paid, predeclared development experiment. Never run by npm test.
import { mkdtemp, readFile, writeFile, cp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Router } from '../../lib/runtime.js'
import { metrics } from '../../lib/metrics.js'
import { snapshot } from '../../lib/executor.js'
import { digest } from '../../lib/schema.js'
import { image, sourceCommit, inventory, fingerprint, expected, programs } from './protocol.js'
import { evolutionStream, evolutionSuite, templateCandidate } from './evolution-protocol.js'
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const plugin = fileURLToPath(new URL('../../', import.meta.url))
const authPath = await realpath(process.argv[2]), source = await realpath(process.argv[3])
const auth = JSON.parse(await readFile(authPath, 'utf8')), sourceView = await inventory(source)
const data = JSON.parse(await readFile(join(workspace, `vendor/intercode-${sourceCommit}/data/nl2bash/nl2bash_fs_1.json`)))
const resume = process.argv[4] ? await realpath(process.argv[4]) : null
const stream = evolutionStream(data), suite = evolutionSuite(data), output = resume ?? await mkdtemp(join(workspace, 'results/DSH_EVOLUTION_'))
const journal = join(output, 'network.jsonl'), sandbox = join(plugin, '.sandbox'), conditions = ['B0', 'B1', 'B2', 'B3', 'B4']
const routers = {}, verified = {}, observed = {}
if (!resume) await writeFile(journal, '', { mode: 0o600 })
const redact = s => String(s).replaceAll(auth.apiKey, '[REDACTED]')
const report = resume ? JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) : { started: new Date().toISOString(), model: auth.model ?? 'deepseek-v4-flash', sourceCommit, image, sourceFingerprint: fingerprint(sourceView),
  maxHTTPCalls: 54, previousAttemptHTTPRequests: 10, previousAttempt: 'DSH_EVOLUTION_7YVOUi', answerContract: 'integer-only', stream, suiteHash: digest(suite), protocol: '2026-09-11_SELF_EVOLUTION_PROTOCOL.md',
  protocolHash: digest(await readFile(join(workspace, 'experiments/2026-09-11_SELF_EVOLUTION_PROTOCOL.md'), 'utf8')),
  codeHashes: {}, runs: [], maintenance: [], shared: [], summary: {} }
if (resume) {
  if (report.completed !== false || report.error !== 'Maintenance process failed' || report.runs.length !== 6 || report.sourceFingerprint !== fingerprint(sourceView) || report.suiteHash !== digest(suite)) throw Error('Resume supports only intact pre-synthesis startup interruption')
  await cp(join(output, 'report.json'), join(output, `report-before-resume-${randomUUID()}.json`))
  report.interruptions = [...(report.interruptions ?? []), { time: new Date().toISOString(), error: report.error, reason: 'Fix maintenance startup placeholder; no synthesis response has been observed; prefix and journal reused, not retried.' }]
  delete report.error; delete report.completed
}
const codeHashes = {}
for (const file of ['benchmarks/intercode/evolution.js', 'benchmarks/intercode/evolution-protocol.js', 'benchmarks/intercode/dsh-backend.js', 'run.js', 'lib/runtime.js', 'lib/validation.js', 'scripts/acceptance-network.js']) codeHashes[file] = digest(await readFile(join(plugin, file), 'utf8'))
if (resume) report.continuationCodeHashes = codeHashes; else report.codeHashes = codeHashes
const checkpoint = () => writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2)), { mode: 0o600 })
const requests = async () => (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(e => e.type === 'request').length
async function launch(condition, query, learn = false) {
  const root = routers[condition].store.root, before = await requests()
  const result = await new Promise((resolve, reject) => {
    const args = ['--import', join(plugin, 'scripts/acceptance-network.js'), join(plugin, 'run.js'), '--auth-file', authPath, '--benchmark-file', join(output, `${condition}-backend.json`)]
    if (learn) args.push('--benchmark-learn-only'); else args.push(query)
    const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ROUTER_ACCEPTANCE_AUTH: authPath, ROUTER_ACCEPTANCE_JOURNAL: journal, ROUTER_ACCEPTANCE_MAX_CALLS: String(report.maxHTTPCalls) }, stdio: ['ignore', 'pipe', 'pipe'] })
    const start = performance.now(); let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL') }, 90000)
    p.stdout.on('data', b => { stdout = (stdout + b).slice(-100000) }); p.stderr.on('data', b => { stderr = (stderr + b).slice(-100000) })
    p.on('error', e => { clearTimeout(timer); reject(e) }); p.on('close', code => { clearTimeout(timer); resolve({ code, timedOut, stdout: redact(stdout), stderr: redact(stderr), wallMs: performance.now() - start }) })
  })
  return { ...result, httpRequests: await requests() - before }
}
async function saveState(condition, label) {
  await writeFile(join(output, `${condition}-${label}-state.json`), redact(JSON.stringify(await routers[condition].store.read(), null, 2)), { mode: 0o600 })
}
async function prepare(condition) {
  const root = join(output, condition); await mkdir(root); await cp(source, root, { recursive: true })
  const router = routers[condition] = new Router(root); verified[condition] = []; observed[condition] = []
  await router.store.configure({ enabled: true, learning: false, image, dockerContext: 'colima', snapshotDirectory: sandbox,
    maxModelCallsPerDay: 3, maxLearningTokensPerDay: 400000, maxOutputTokens: 4096 })
  await writeFile(join(router.store.dir, 'evals.json'), JSON.stringify(suite))
  await writeFile(join(output, `${condition}-backend.json`), JSON.stringify({ root, image, journal: join(output, `${condition}-tools.jsonl`), answerContract: report.answerContract }))
}
async function cleanHistory(condition) {
  // Raw history events are immutable evidence. Only the learner's working set
  // is replaced with externally verified past observations, not gold answers.
  await routers[condition].store.transaction(s => { s.history = structuredClone(verified[condition]) })
}
async function task(condition, t) {
  const result = await launch(condition, t.query), router = routers[condition]
  const state = await router.store.read(), turn = state.events.filter(e => e.type === 'agent-turn').at(-1)
  const oracle = expected(t, sourceView.files), correct = result.code === 0 && result.stdout.trim() === oracle.trim()
  const row = { condition, index: t.index, split: t.split, query: t.query, oracle, ...result, correct, routed: turn?.routed ?? false, turn }
  report.runs.push(row)
  if (correct) {
    verified[condition].push({ id: randomUUID(), time: new Date().toISOString(), request: t.query, output: result.stdout.trim(), evidence: 'external-exact-oracle-verified', usage: turn?.usage ?? null })
    observed[condition].push(t)
  }
  await cleanHistory(condition)
  const copy = await snapshot(router.store.root, sandbox)
  try { row.sourceUnchanged = fingerprint(await inventory(copy)) === report.sourceFingerprint } finally { await rm(copy, { recursive: true, force: true }) }
  await saveState(condition, String(t.index)); await checkpoint()
  console.log(JSON.stringify({ condition, index: t.index, correct, routed: row.routed, calls: row.httpRequests, wallMs: row.wallMs }))
  if (result.code !== 0 || !row.sourceUnchanged || !turn) throw Error('Execution/environment integrity failure')
  if (row.routed && row.httpRequests !== 0) throw Error('Routed request called provider')
}
async function maintain(condition, label, candidate) {
  const start = performance.now(), before = await requests(); let result
  if (candidate) {
    const admission = await routers[condition].admit(candidate)
    result = { code: 0, admission }
    if (!admission.proof.passed) throw Error(`Fixed template/static control failed admission: ${label}`)
  } else result = await launch(condition, '', true)
  const state = await routers[condition].store.read()
  const row = { condition, label, ...result, wallMs: performance.now() - start, httpRequests: await requests() - before,
    active: state.active, errors: state.events.filter(e => e.type === 'synthesis-error').map(e => e.error) }
  report.maintenance.push(row); await saveState(condition, label); await checkpoint()
  console.log(JSON.stringify({ condition, label, calls: row.httpRequests, active: row.active, errors: row.errors, wallMs: row.wallMs }))
  if (result.code !== 0 || result.timedOut) throw Error('Maintenance process failed')
}
console.log(JSON.stringify({ output, maxHTTPCalls: report.maxHTTPCalls, previousAttemptHTTPRequests: 10, original: 5, synthetic: 3 }))
await checkpoint()
try {
  if (!resume) {
  for (const condition of conditions) await prepare(condition)
  verified.B1 = ['manual-fixture-a', 'manual-fixture-b'].map(id => ({ id, evidence: 'manual-independent-fixture', request: 'Handwritten known-family static upper bound', output: '' }))
  await cleanHistory('B1'); await maintain('B1', 'static-admission', programs(data).find(p => p.id === 'recursive-lines'))
  for (const t of stream.slice(0, 3)) { await task('B0', t); await task('B1', t) }
  if (verified.B0.length !== 3) throw Error('Insufficient verified common prefix; no fabricated successful history')
  const prefixState = await routers.B0.store.read()
  for (const condition of ['B2', 'B3', 'B4']) {
    verified[condition] = structuredClone(verified.B0); observed[condition] = structuredClone(observed.B0)
    await routers[condition].store.transaction(s => Object.assign(s, structuredClone(prefixState)))
    report.shared.push({ condition, source: 'B0', indices: [20, 22, 28], charged: true })
  }
  await maintain('B2', 'prefix-templates', templateCandidate(data, observed.B2, verified.B2))
  } else {
    for (const condition of conditions) {
      const router = routers[condition] = new Router(join(output, condition)), state = await router.store.read()
      if (state.config.learning || state.config.image !== image) throw Error('Resume configuration mismatch')
      verified[condition] = state.history
      observed[condition] = stream.slice(0, 3).filter(t => state.history.some(h => h.request === t.query))
    }
    if ((await routers.B3.store.read()).events.some(e => e.type === 'synthesis-start')) throw Error('Resume cannot retry an observed synthesis')
  }
  await maintain('B3', 'initial-synthesis')
  const initialState = await routers.B3.store.read()
  await routers.B4.store.transaction(s => Object.assign(s, structuredClone(initialState)))
  report.shared.push({ condition: 'B4', source: 'B3', maintenance: 'initial-synthesis', charged: true, stateHash: digest(initialState) })
  await saveState('B4', 'initial-clone')
  for (const t of stream.slice(3)) {
    // Rotate paired order to reduce systematic first/last launch effects.
    const order = t.index === 56 || t.index === 'probe-2' ? [...conditions].reverse() : conditions
    for (const condition of order) await task(condition, t)
    if (t.split === 'original-development') {
      const state = await routers.B2.store.read()
      await maintain('B2', `update-${t.index}`, templateCandidate(data, observed.B2, verified.B2, state.active['recursive-lines'] ?? null))
      await maintain('B4', `update-${t.index}`)
    }
  }
  report.completed = true
} catch (error) { report.completed = false; report.error = redact(error.message); process.exitCode = 1 }
finally {
  report.finished = new Date().toISOString(); report.physicalHTTPRequests = await requests()
  for (const condition of conditions) if (routers[condition]) {
    const state = await routers[condition].store.read(), sharedPrefix = ['B2', 'B3', 'B4'].includes(condition) ? report.runs.filter(r => r.condition === 'B0' && [20, 22, 28].includes(r.index)) : []
    const rows = [...sharedPrefix, ...report.runs.filter(r => r.condition === condition)]
    const maintenance = report.maintenance.filter(m => m.condition === condition)
    if (condition === 'B4') maintenance.push(...report.maintenance.filter(m => m.condition === 'B3' && m.label === 'initial-synthesis'))
    const groups = {}
    for (const [label, subset] of Object.entries({ original: rows.filter(r => r.split === 'original-development'), futureOriginal: rows.filter(r => [40, 56].includes(r.index)), probes: rows.filter(r => r.split === 'synthetic-reuse-probe') })) groups[label] = {
      n: subset.length, success: subset.filter(r => r.correct).length, routed: subset.filter(r => r.routed).length, correctRouted: subset.filter(r => r.routed && r.correct).length,
      incorrectAutomation: subset.filter(r => r.routed && !r.correct).length, wallMs: subset.reduce((n, r) => n + r.wallMs, 0) }
    report.summary[condition] = { ...groups, metrics: metrics(state), logicalHTTPRequests: rows.reduce((n, r) => n + r.httpRequests, 0) + maintenance.reduce((n, r) => n + r.httpRequests, 0),
      requestWallMs: rows.reduce((n, r) => n + r.wallMs, 0), lifecycleWallMs: maintenance.reduce((n, r) => n + r.wallMs, 0),
      totalWallMs: rows.reduce((n, r) => n + r.wallMs, 0) + maintenance.reduce((n, r) => n + r.wallMs, 0) }
    await saveState(condition, 'final')
  }
  await checkpoint(); console.log(JSON.stringify({ output, completed: report.completed, error: report.error, physicalHTTPRequests: report.physicalHTTPRequests, summary: report.summary }))
}
