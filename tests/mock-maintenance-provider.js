import { appendFileSync } from 'node:fs'
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://benchmark.invalid/v1/chat/completions') throw Error('Unexpected network')
  const body = JSON.parse(options.body)
  if (body.tools?.length) throw Error('Maintenance must expose no tools')
  if (JSON.stringify(body.messages).includes('benchmark maintenance only')) throw Error('Placeholder leaked to model')
  appendFileSync(process.env.BENCH_TEST_CALLS, JSON.stringify({ tools: body.tools ?? [], messages: body.messages }) + '\n')
  const chunk = { id: 'offline-maintenance', model: 'offline', choices: [{ index: 0, delta: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } }
  return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}
