import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { compatibleSseStream } from '../lib/sse-compat.js'
test('pinned native DeepSeek adapter retains tool identity and late usage after gateway normalization', { skip: process.env.ROUTER_NATIVE_TEST !== '1' }, async t => {
  const anchor = await realpath(fileURLToPath(new URL('../../../dsh-runtime/node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
  const require = createRequire(anchor)
  const { DeepSeekAdapter, resolveAdapterOptions } = await import(require.resolve('@deepseek-ai/dsh-llm-deepseek'))
  const chunks = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-real-shape', type: 'function', function: { name: 'bash', arguments: '' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: '', type: '', function: { name: '', arguments: '{"command":"ls"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [{ index: 0, delta: {} }], usage: { prompt_tokens: 7491, completion_tokens: 64, total_tokens: 7555, prompt_tokens_details: { cached_tokens: 6144 } } },
  ]
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => {
    const raw = new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n')
    return new Response(compatibleSseStream(raw.body), { headers: { 'content-type': 'text/event-stream' } })
  }
  const adapter = new DeepSeekAdapter({ options: () => resolveAdapterOptions({ thinking: 'disabled', reasoningEffort: 'off', baseURL: 'https://offline.invalid', models: [] }), resolveApiKey: async () => 'offline-fixture', resolveUserId: () => 'offline' })
  const result = []
  for await (const chunk of adapter.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [], tools: [], maxTokens: 100, reasoningEffort: 'off' })) result.push(chunk)
  const tool = result.find(c => c.type === 'block-end' && c.block.type === 'tool-call')?.block
  assert.equal(tool?.id, 'call-real-shape', JSON.stringify(result)); assert.equal(tool?.name, 'bash')
  const usage = result.find(c => c.type === 'usage')?.usage
  assert.equal(usage.inputTokens, 1347, JSON.stringify(result))
  assert.equal(usage.cacheReadTokens, 6144)
  assert.equal(usage.inputTokens + usage.cacheReadTokens, 7491)
})
