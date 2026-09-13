// Explicit offline full-host protocol test; no network request is permitted.
import { appendFileSync } from 'node:fs'
let calls = 0
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://benchmark.invalid/v1/chat/completions') throw Error('Unexpected network in offline benchmark test')
  const body = JSON.parse(options.body)
  if (body.tools.length !== 1 || body.tools[0].function.name !== 'bash') throw Error('Non-isolated tool exposed')
  appendFileSync(process.env.BENCH_TEST_CALLS, JSON.stringify({ call: ++calls, tools: body.tools.map(t => t.function.name) }) + '\n')
  if (calls > 2) throw Error('Offline call limit exceeded')
  const choice = calls === 1 ? { index: 0, delta: { tool_calls: [{ index: 0, id: 'test-call', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: process.env.BENCH_TEST_COMMAND, description: 'Check isolated fixture' }) } }] }, finish_reason: 'tool_calls' }
    : { index: 0, delta: { content: 'ok.txt\n' }, finish_reason: 'stop' }
  const chunk = { id: 'offline', model: 'offline', choices: [choice], usage: { prompt_tokens: 2, completion_tokens: 1 } }
  return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}
