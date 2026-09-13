import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './helpers.js'

function launch(root, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../run.js', import.meta.url)), request], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 45000)
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-20000) })
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-20000) })
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, stdout, stderr }) })
  })
}

test('installed full DSH profile serves an admitted program and persists the real session outcome', { skip: process.env.ROUTER_PROFILE_TEST !== '1' }, async t => {
  const { router, root, candidate } = await fixture(t)
  await router.store.configure({ learning: false })
  assert.equal((await router.admit(candidate)).proof.passed, true)
  await writeFile(join(root, 'accepted.txt'), 'fixture\n')
  const result = await launch(root, 'list visible files')
  assert.equal(result.timedOut, false, JSON.stringify(result))
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.match(result.stdout, /accepted\.txt/, JSON.stringify(result))
  const state = await router.store.read()
  assert.equal(state.events.filter(e => e.type === 'route-decision' && e.kind === 'completed').length, 1)
  const turn = state.events.find(e => e.type === 'agent-turn')
  assert.equal(turn?.reason, 'completed', JSON.stringify(state.events))
  assert.equal(turn?.modelMessages, 0)
  assert.equal(turn?.routed, true)
})
