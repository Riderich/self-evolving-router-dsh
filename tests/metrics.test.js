import test from 'node:test'
import assert from 'node:assert/strict'
import { metrics } from '../lib/metrics.js'

test('disjoint input usage and failed admission do not double count model time', () => {
  const result = metrics({ budget: {}, events: [
    { type: 'agent-turn', usage: { inputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 2, outputTokens: 3, reasoningTokens: 1 } },
    { type: 'synthesis-end', durationMs: 100 },
    { type: 'synthesis-error', durationMs: 110, modelCallDurationMs: 0 },
    { type: 'synthesis-error', durationMs: 50, modelCallDurationMs: 50 },
  ] })
  assert.equal(result.baseUsage.totalInputTokens, 27)
  assert.equal(result.baseUsage.outputTokens, 3)
  assert.equal(result.durationMs.synthesis, 150)
})
