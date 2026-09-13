import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, image } from './helpers.js'
test('maintenance-only uses native synthesis, no agent turn or tools, and restores learning:false', { skip: process.env.ROUTER_PROFILE_TEST !== '1' }, async t => {
  const { router, root } = await fixture(t)
  await router.store.configure({ learning: false, minHistory: 2 })
  const control = await mkdtemp(join(tmpdir(), 'router-maintenance-test-'))
  t.after(() => rm(control, { recursive: true, force: true }))
  const auth = join(control, 'auth.json'), config = join(control, 'config.json'), calls = join(control, 'calls.jsonl')
  await writeFile(auth, JSON.stringify({ apiKey: 'offline-only', baseURL: 'https://benchmark.invalid/v1' }), { mode: 0o600 })
  await writeFile(config, JSON.stringify({ root, image, journal: join(control, 'tools.jsonl') }))
  const result = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', fileURLToPath(new URL('./mock-maintenance-provider.js', import.meta.url)), fileURLToPath(new URL('../run.js', import.meta.url)), '--auth-file', auth, '--benchmark-file', config, '--benchmark-learn-only'],
      { cwd: root, env: { ...process.env, BENCH_TEST_CALLS: calls }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; const timer = setTimeout(() => p.kill('SIGKILL'), 30000)
    p.stdout.on('data', b => { stdout += b }); p.stderr.on('data', b => { stderr += b })
    p.on('error', reject); p.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.match(result.stdout, /"error":"Invalid /)
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 1)
  const state = await router.store.read()
  assert.equal(state.config.learning, false)
  assert.equal(state.events.filter(e => e.type === 'agent-turn').length, 0)
  assert.equal(state.events.filter(e => e.type === 'synthesis-end').length, 1)
  assert.deepEqual(state.active, {})
})
