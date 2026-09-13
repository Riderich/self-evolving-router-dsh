// Explicitly invoked live-provider acceptance, never included in npm test.
import { mkdtemp, readFile, writeFile, realpath, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { Router } from '../lib/runtime.js'
import { metrics } from '../lib/metrics.js'

const authPath = await realpath(process.argv[2])
const auth = JSON.parse(await readFile(authPath, 'utf8'))
const resultsBase = fileURLToPath(new URL('../../../results/', import.meta.url))
const output = await mkdtemp(join(resultsBase, 'DSH_LIVE_ACCEPTANCE_'))
const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-live-project-')))
const journal = join(output, 'network.jsonl')
await writeFile(journal, '', { mode: 0o600 })
const router = new Router(root)
await router.store.configure({ enabled: true, learning: true, maxModelCallsPerDay: 2, maxLearningTokensPerDay: 220000, maxOutputTokens: 4096,
  image: 'sha256:2260313b31c8c011cd2eebe728008efac1b3982be73eb71348ea2648d2c0e09b', dockerContext: 'colima',
  snapshotDirectory: fileURLToPath(new URL('../.sandbox', import.meta.url)) })
await writeFile(join(router.store.dir, 'evals.json'), await readFile(new URL('../examples/evals.json', import.meta.url)))
const summary = { root, output, model: auth.model ?? 'deepseek-v4-flash', endpoint: auth.baseURL, started: new Date().toISOString(), runs: [] }
await writeFile(join(output, 'run.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ output, root, model: summary.model }))
const redact = text => String(text).replaceAll(auth.apiKey, '[REDACTED]')
async function run(index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./acceptance-network.js', import.meta.url)), fileURLToPath(new URL('../run.js', import.meta.url)), '--auth-file', authPath, 'list visible files'],
      { cwd: root, env: { ...process.env, ROUTER_ACCEPTANCE_AUTH: authPath, ROUTER_ACCEPTANCE_JOURNAL: journal }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false
    const started = performance.now(), timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-100000) }); child.stderr.on('data', b => { stderr = (stderr + b).slice(-100000) })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => { clearTimeout(timer); resolve({ index, code, timedOut, durationMs: performance.now() - started, stdout: redact(stdout), stderr: redact(stderr) }) })
  })
}
try {
  for (let i = 1; i <= 4; i++) {
    await writeFile(join(root, `file-${i}.txt`), `fixture ${i}\n`)
    const requestCount = async () => (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === 'request').length
    const requestsBefore = await requestCount()
    const result = await run(i)
    result.httpRequests = await requestCount() - requestsBefore
    summary.runs.push(result)
    const state = await router.store.read()
    await writeFile(join(output, `state-${i}.json`), JSON.stringify(state, null, 2), { mode: 0o600 })
    await writeFile(join(output, 'run.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify({ index: i, code: result.code, durationMs: result.durationMs, active: Object.keys(state.active), history: state.history.length, errors: state.events.filter(e => e.type === 'synthesis-error').map(e => e.error), stdout: result.stdout, stderr: result.stderr }))
    assert.equal(result.code, 0, 'DSH request failed')
    if (i === 3) assert.ok(Object.keys(state.active).length > 0, 'No automatically admitted program after three real requests')
    if (i === 4) {
      const turn = state.events.filter(e => e.type === 'agent-turn').at(-1)
      assert.equal(turn.routed, true); assert.equal(turn.modelMessages, 0)
      assert.equal(result.httpRequests, 0, 'Warm route must not call the provider')
      assert.equal(result.stdout.trim(), Array.from({ length: 4 }, (_, n) => `file-${n + 1}.txt`).join('\n'))
    }
  }
  summary.passed = true
} catch (e) { summary.passed = false; summary.error = redact(e.message); process.exitCode = 1 }
finally {
  summary.finished = new Date().toISOString(); summary.metrics = metrics(await router.store.read())
  await writeFile(join(output, 'run.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ passed: summary.passed, error: summary.error, output, metrics: summary.metrics }))
}
