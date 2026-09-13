import test from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../lib/runtime.js'
import { applyRepair, repairTarget } from '../lib/repair.js'
import { digest } from '../lib/schema.js'
import { fixture, fakeExecutor } from './helpers.js'

test('persistent failure feedback repairs templates without rewriting passing script', async t => {
  const { router, root, candidate } = await fixture(t, { executor: fakeExecutor })
  await router.store.configure({ minHistory: 2, learningMode: 'feedback-local' })
  const broken = { ...candidate, templates: ['list other files'] }
  const first = await router.admit(broken)
  assert.equal(first.proof.passed, false)
  assert.equal(first.proof.results[0].category, 'binding-miss')
  let calls = 0
  const resumed = new Router(root, { executor: fakeExecutor, model: async prompt => {
    calls++
    assert.match(prompt, /binding-miss/)
    assert.match(prompt, /boundary-pass/)
    assert.ok(prompt.includes(broken.script.replaceAll('\n', '\\n')))
    return { text: JSON.stringify({ baseHash: first.hash, reason: 'Fix only matching literals', edits: [{ field: 'templates', before: broken.templates, after: candidate.templates }] }), usage: { inputTokens: 100, outputTokens: 50 } }
  } })
  const fixed = await resumed.learn()
  assert.equal(fixed.proof.passed, true)
  const state = await resumed.store.read()
  assert.equal(state.candidates[fixed.hash].candidate.script, broken.script)
  assert.equal(state.candidates[fixed.hash].repair.baseHash, first.hash)
  assert.equal(state.candidates[first.hash].proof.passed, false)
  assert.equal(state.active[candidate.id], fixed.hash)
  assert.equal(calls, 1)
})

test('local edits reject stale bases, identity edits, full rewrites and ambiguous patches', async t => {
  const { candidate } = await fixture(t)
  const proposal = edit => ({ baseHash: digest(candidate), reason: 'test repair', edits: [edit] })
  assert.throws(() => applyRepair(candidate, { ...proposal({ field: 'description', before: candidate.description, after: 'fixed' }), baseHash: '0'.repeat(64) }), /Stale/)
  assert.throws(() => applyRepair(candidate, proposal({ field: 'sourceIds', before: candidate.sourceIds, after: ['x', 'y'] })), /Immutable/)
  assert.throws(() => applyRepair(candidate, proposal({ field: 'script', before: candidate.script, after: '#!/bin/sh\ntrue' })), /Whole/)
  assert.throws(() => applyRepair(candidate, proposal({ field: 'script', before: 'absent', after: 'true' })), /exactly once/)
  const next = applyRepair(candidate, proposal({ field: 'script', before: 'ls -1', after: 'ls -1A' }))
  assert.equal(next.script, candidate.script.replace('ls -1', 'ls -1A'))
  assert.deepEqual(next.templates, candidate.templates)
})

test('failed local repair reruns every case, preserves active version, and obeys call cap', async t => {
  const { router, root, candidate } = await fixture(t, { executor: fakeExecutor })
  const good = await router.admit(candidate)
  const bad = { ...candidate, parent: good.hash, templates: ['list other files'] }
  await router.admit(bad)
  await router.store.configure({ minHistory: 2, learningMode: 'feedback-local', maxModelCallsPerDay: 1 })
  let calls = 0
  const resumed = new Router(root, { executor: fakeExecutor, model: async () => {
    calls++
    return { text: JSON.stringify({ baseHash: digest(bad), reason: 'Partial but insufficient edit', edits: [{ field: 'templates', before: bad.templates, after: ['list still other files'] }] }) }
  } })
  const failed = await resumed.learn()
  assert.equal(failed.proof.passed, false)
  assert.equal(failed.proof.results.length, 4)
  assert.equal((await resumed.store.read()).active[candidate.id], good.hash)
  assert.equal((await resumed.learn()).skipped, 'budget-or-already-processed')
  assert.equal(calls, 1)
})

test('output mismatch feedback includes actual and expected, exceptions do not skip regression cases', async t => {
  let runs = 0
  const { router, candidate } = await fixture(t, { executor: { async execute() {
    if (++runs === 1) throw Error('execution timeout')
    return { stdout: 'wrong\n', stderr: '', exitCode: 0, durationMs: 1 }
  } } })
  const { proof } = await router.admit(candidate)
  assert.equal(proof.results.length, 4)
  assert.equal(proof.results[0].category, 'validation-error')
  assert.equal(proof.results[1].category, 'output-mismatch')
  assert.equal(proof.results[1].actual.stdout, 'wrong\n')
  assert.equal(proof.results[1].expected.stdout, 'b.txt\n')
})

test('binding diagnostics identify rejected raw captures before any script execution', async t => {
  const { router, candidate } = await fixture(t, { executor: fakeExecutor })
  const broken = { ...candidate, templates: ['list {extension} files'], parameters: [{ name: 'extension', type: 'extension' }] }
  // This fixture captures a valid bare word; force a rejected enum contract instead.
  broken.parameters = [{ name: 'extension', type: 'enum', values: ['php'] }]
  const { proof } = await router.admit(broken)
  assert.equal(proof.results[0].bindingDiagnostics[0].captured.extension, 'visible')
  assert.equal(proof.results[0].bindingDiagnostics[0].reason, 'parameter-rejected')
})

test('binding-only failures lock the script and feed rejection into the next bounded repair', async t => {
  const { router, root, candidate } = await fixture(t, { executor: fakeExecutor })
  const broken = { ...candidate, templates: ['list other files'] }
  const seed = await router.admit(broken)
  await router.store.configure({ minHistory: 2, learningMode: 'feedback-local' })
  let calls = 0
  const resumed = new Router(root, { executor: fakeExecutor, model: async prompt => {
    calls++
    if (calls === 2) assert.match(prompt, /script is locked/)
    return { text: JSON.stringify({ baseHash: seed.hash, reason: 'Repair test', edits: calls === 1
      ? [{ field: 'script', before: 'ls -1', after: 'ls -1A' }]
      : [{ field: 'templates', before: broken.templates, after: candidate.templates }] }) }
  } })
  assert.match((await resumed.learn()).error, /script is locked/)
  assert.equal((await resumed.learn()).proof.passed, true)
  assert.equal(calls, 2)
})

test('regressed local candidate is retained for audit but is not the next repair base', async t => {
  const executor = { async execute(c, args, root) {
    const r = await fakeExecutor.execute(c, args, root)
    // Seed passes a.txt, fails b.txt; repair flips them, losing an established pass.
    if (c.script.includes('ls -1A') ? r.stdout === 'a.txt\n' : r.stdout === 'b.txt\n') r.stdout = 'wrong\n'
    return r
  } }
  const { router, root, candidate } = await fixture(t, { executor })
  const seed = await router.admit(candidate)
  await router.store.configure({ minHistory: 2, learningMode: 'feedback-local' })
  const resumed = new Router(root, { executor, model: async () => ({ text: JSON.stringify({ baseHash: seed.hash, reason: 'Regression test', edits: [{ field: 'script', before: 'ls -1', after: 'ls -1A' }] }) }) })
  const repaired = await resumed.learn(), state = await resumed.store.read()
  assert.deepEqual(state.candidates[repaired.hash].repair.regressedCaseIds, ['one'])
  assert.equal(repairTarget(state)[0], seed.hash)
  assert.deepEqual(state.active, {})
})
