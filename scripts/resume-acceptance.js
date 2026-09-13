// Continue a recorded acceptance without rewriting its failed run or consuming
// the same cold histories again. Shares the original hard HTTP-call budget.
import { readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Router } from '../lib/runtime.js'
import { metrics } from '../lib/metrics.js'
import assert from 'node:assert/strict'
const authPath = await realpath(process.argv[2]), output = await realpath(process.argv[3])
const auth = JSON.parse(await readFile(authPath, 'utf8')), prior = JSON.parse(await readFile(join(output, 'run.json'), 'utf8'))
const root = await realpath(prior.root)
assert.ok(root.includes('/dsh-live-project-'), 'Not an acceptance fixture')
const router = new Router(root), journal = join(output, 'network.jsonl'), summary = { started: new Date().toISOString(), prior: 'run.json', runs: [] }
const suffix = Date.now(), report = join(output, `continuation-${suffix}.json`)
async function launch(index) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./acceptance-network.js', import.meta.url)), fileURLToPath(new URL('../run.js', import.meta.url)), '--auth-file', authPath, 'list visible files'], { cwd: root,
      env: { ...process.env, ROUTER_ACCEPTANCE_AUTH: authPath, ROUTER_ACCEPTANCE_JOURNAL: journal }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000)
    child.stdout.on('data', b => { stdout += b }); child.stderr.on('data', b => { stderr += b })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => { clearTimeout(timer); resolve({ index, code, durationMs: performance.now() - started, stdout: stdout.replaceAll(auth.apiKey, '[REDACTED]'), stderr: stderr.replaceAll(auth.apiKey, '[REDACTED]') }) })
  })
}
try {
  for (let step = 0; step < 3; step++) {
    const before = await router.store.read(), expectHit = Object.keys(before.active).length > 0
    const index = (await readdir(root)).filter(x => /^file-\d+\.txt$/.test(x)).length + 1
    await writeFile(join(root, `file-${index}.txt`), `fixture ${index}\n`)
    const result = await launch(index), state = await router.store.read()
    summary.runs.push(result)
    await writeFile(join(output, `continued-state-${index}-${suffix}.json`), JSON.stringify(state, null, 2), { mode: 0o600 })
    await writeFile(report, JSON.stringify(summary, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ ...result, expectHit, history: state.history.length, active: Object.keys(state.active), errors: state.events.filter(e => e.type === 'synthesis-error').map(e => e.error) }))
    assert.equal(result.code, 0)
    if (expectHit) {
      const turn = state.events.filter(e => e.type === 'agent-turn').at(-1)
      assert.equal(turn.routed, true); assert.equal(turn.modelMessages, 0)
      assert.equal(result.stdout.trim(), Array.from({ length: index }, (_, i) => `file-${i + 1}.txt`).join('\n'))
      summary.passed = true; break
    }
    if (state.history.length >= 3) assert.ok(Object.keys(state.active).length, 'Candidate not admitted; inspect preserved validation evidence')
  }
  assert.equal(summary.passed, true, 'No warm routed completion')
} catch (e) { summary.passed = false; summary.error = e.message; process.exitCode = 1 }
finally { summary.finished = new Date().toISOString(); summary.metrics = metrics(await router.store.read()); await writeFile(report, JSON.stringify(summary, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ ...summary, report })) }
