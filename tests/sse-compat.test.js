import test from 'node:test'
import assert from 'node:assert/strict'
import { compatibleSseStream } from '../lib/sse-compat.js'
async function normalize(chunks, width = 17) {
  const bytes = new TextEncoder().encode(chunks.map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n')
  let position = 0
  const stream = new ReadableStream({ pull(c) { if (position >= bytes.length) return c.close(); c.enqueue(bytes.slice(position, position + width)); position += width } })
  const text = await new Response(compatibleSseStream(stream)).text()
  return text.split('\n').filter(x => x.startsWith('data: {')).map(x => JSON.parse(x.slice(6)))
}
test('empty identity deltas do not erase an established tool identity', async () => {
  const rows = await normalize([
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'bash', arguments: '' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: '', type: '', function: { name: '', arguments: '{}' } }] } }] },
  ], 1)
  assert.equal(rows[0].choices[0].delta.tool_calls[0].id, 'call-1')
  assert.equal(rows[1].choices[0].delta.tool_calls[0].id, undefined)
  assert.equal(rows[1].choices[0].delta.tool_calls[0].function.name, undefined)
  assert.equal(rows[1].choices[0].delta.tool_calls[0].function.arguments, '{}')
})
test('late usage is attached before the consumer sees finish_reason', async () => {
  const rows = await normalize([
    { choices: [{ index: 0, delta: { content: '你好' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 7491, completion_tokens: 64 } },
  ], 1)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].choices[0].delta.content, '你好')
  assert.equal(rows[1].choices[0].finish_reason, 'stop')
  assert.equal(rows[1].usage.prompt_tokens, 7491)
})
test('finish without usage still terminates; existing final usage is unchanged', async () => {
  const terminal = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  assert.deepEqual(await normalize([terminal]), [terminal])
  const withUsage = { ...terminal, usage: { prompt_tokens: 5, completion_tokens: 1 } }
  assert.deepEqual(await normalize([withUsage]), [withUsage])
})
