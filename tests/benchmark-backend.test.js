import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, image } from './helpers.js'
import { workdir } from '../benchmarks/intercode/dsh-backend.js'

test('benchmark workdir allows only the container workspace', () => {
  assert.equal(workdir(undefined, '/host/fixture'), '/testbed')
  assert.equal(workdir('/host/fixture', '/host/fixture'), '/testbed')
  assert.equal(workdir('nested', '/host/fixture'), '/testbed/nested')
  for (const value of ['/etc', '../', '/testbed/../../', '/testbed-other', 'x\0']) assert.throws(() => workdir(value, '/host/fixture'))
})
for (const adapter of ['deepseek-native', 'pi-chat-completions']) test(`full DSH ${adapter}: baseline and routed branch share isolated files; no host credentials or writes`, { skip: process.env.ROUTER_PROFILE_TEST !== '1' }, async t => {
  const { router, root, candidate } = await fixture(t)
  await router.store.configure({ learning: false })
  await writeFile(join(root, 'ok.txt'), 'fixture\n')
  const control = await mkdtemp(join(tmpdir(), 'dsh-bench-control-'))
  t.after(() => rm(control, { recursive: true, force: true }))
  const auth = join(control, 'auth.json'), config = join(control, 'backend.json'), calls = join(control, 'calls.jsonl'), journal = join(control, 'tools.jsonl')
  await writeFile(auth, JSON.stringify({ apiKey: 'offline-only', baseURL: 'https://benchmark.invalid/v1' }), { mode: 0o600 })
  await writeFile(config, JSON.stringify({ root, image, journal }))
  await writeFile(calls, '')
  const provider = join(control, 'provider.json')
  await writeFile(provider, JSON.stringify({ adapter, model: adapter === 'deepseek-native' ? 'deepseek-v4-flash' : 'test-model' }))
  async function launch() {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--import', fileURLToPath(new URL('./mock-benchmark-provider.js', import.meta.url)), fileURLToPath(new URL('../run.js', import.meta.url)), '--auth-file', auth, '--provider-file', provider, '--benchmark-file', config, 'list visible files'],
        { cwd: root, env: { ...process.env, BENCH_TEST_CALLS: calls, BENCH_TEST_COMMAND: `set -eu; test ! -e '${auth}'; test -z "\${DEEPSEEK_API_KEY-}"; if printf denied 2>/dev/null > /testbed/blocked; then exit 8; fi; ls -1 /testbed` }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => p.kill('SIGKILL'), 45000)
      p.stdout.on('data', b => { stdout += b }); p.stderr.on('data', b => { stderr += b })
      p.on('error', reject); p.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    })
  }
  const baseline = await launch()
  assert.equal(baseline.code, 0, JSON.stringify(baseline))
  const events = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(events.at(-1).stdout, 'ok.txt\n'); assert.equal(events.at(-1).exitCode, 0)
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2)
  assert.equal((await router.admit(candidate)).proof.passed, true)
  const routed = await launch()
  assert.equal(routed.code, 0, JSON.stringify(routed)); assert.equal(routed.stdout.trim(), 'ok.txt')
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2, 'No new provider calls on route')
  assert.equal((await readFile(journal, 'utf8')).trim().split('\n').length, events.length, 'No base tool on route')
})
