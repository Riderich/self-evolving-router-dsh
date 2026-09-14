// Test-only HTTP accounting and hard call ceiling. Never records auth headers.
import { readFileSync, appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const auth = JSON.parse(readFileSync(process.env.ROUTER_ACCEPTANCE_AUTH, 'utf8'))
const target = new URL(auth.baseURL), journal = process.env.ROUTER_ACCEPTANCE_JOURNAL
const original = globalThis.fetch
const maxCalls = Number(process.env.ROUTER_ACCEPTANCE_MAX_CALLS ?? 12)
if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 160) throw Error('Invalid explicit experiment call ceiling')
const redact = text => String(text).replaceAll(auth.apiKey, '[REDACTED]')
const record = data => appendFileSync(journal, redact(JSON.stringify({ time: new Date().toISOString(), ...data })) + '\n', { mode: 0o600 })
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.origin !== target.origin || !url.pathname.endsWith('/chat/completions')) return original(input, init)
  const prior = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
  if (prior.filter(x => x.type === 'request').length >= maxCalls) throw new Error('Live acceptance model-call budget exhausted')
  const id = randomUUID(), started = performance.now()
  record({ type: 'request', id, body: init?.body ? JSON.parse(init.body) : null })
  try {
    const response = await original(input, init)
    const copy = response.clone()
    void (async () => {
      const reader = copy.body.getReader(), decoder = new TextDecoder()
      let body = ''
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; body += decoder.decode(value, { stream: true }) }
        body += decoder.decode()
        record({ type: 'response', id, status: response.status, durationMs: performance.now() - started, body })
      } catch (error) { record({ type: 'response-error', id, status: response.status, partialBody: body, error: String(error), durationMs: performance.now() - started }) }
    })()
    return response
  } catch (error) { record({ type: 'transport-error', id, error: String(error), durationMs: performance.now() - started }); throw error }
}
