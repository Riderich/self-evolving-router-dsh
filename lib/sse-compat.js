// Compatibility at the configured gateway boundary, not a change to the agent.
// Some OpenAI-compatible gateways send empty tool identity deltas and put usage
// after finish_reason. The pinned native DSH adapter needs identities retained
// and final usage attached to its terminating chunk.
export function compatibleSseStream(body) {
  const decoder = new TextDecoder(), encoder = new TextEncoder()
  let pending = '', terminal = null
  const identities = new Map()
  const serialize = value => `data: ${JSON.stringify(value)}\n\n`
  function handle(frame, controller) {
    const lines = frame.split('\n'), data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
    if (!data) { controller.enqueue(encoder.encode(frame + '\n\n')); return }
    if (data === '[DONE]') {
      if (terminal) { controller.enqueue(encoder.encode(serialize(terminal))); terminal = null }
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); return
    }
    let chunk
    try { chunk = JSON.parse(data) } catch { controller.enqueue(encoder.encode(frame + '\n\n')); return }
    for (const choice of chunk.choices ?? []) for (const call of choice.delta?.tool_calls ?? []) {
      const key = `${choice.index ?? 0}:${call.index ?? 0}`, old = identities.get(key) ?? {}
      if (call.id === '' && old.id) delete call.id
      if (call.function?.name === '' && old.name) delete call.function.name
      if (call.type === '' && old.type) delete call.type
      identities.set(key, { id: call.id || old.id, name: call.function?.name || old.name, type: call.type || old.type })
    }
    if (terminal && chunk.usage) {
      terminal.usage = chunk.usage
      controller.enqueue(encoder.encode(serialize(terminal))); terminal = null
      // The usage-only trailing event has now been consumed exactly once.
      if (!(chunk.choices ?? []).some(c => Object.keys(c.delta ?? {}).length > 0 || c.finish_reason)) return
    }
    if ((chunk.choices ?? []).some(c => c.finish_reason) && !chunk.usage) { terminal = chunk; return }
    controller.enqueue(encoder.encode(serialize(chunk)))
  }
  return body.pipeThrough(new TransformStream({
    transform(bytes, controller) {
      pending += decoder.decode(bytes, { stream: true })
      // Normalize CRLF only once a full line ending is available.
      pending = pending.replace(/\r\n/g, '\n')
      let end
      while ((end = pending.indexOf('\n\n')) >= 0) { const frame = pending.slice(0, end); pending = pending.slice(end + 2); handle(frame, controller) }
      if (pending.length > 2 * 1024 * 1024) throw new Error('Oversized SSE event')
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending.trim()) handle(pending, controller)
      if (terminal) controller.enqueue(encoder.encode(serialize(terminal)))
    },
  }))
}
export function installGatewayCompatibility(baseURL) {
  const target = new URL(baseURL), original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init)
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== target.origin || url.pathname !== target.pathname.replace(/\/$/, '') + '/chat/completions' || !response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) return response
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding')
    return new Response(compatibleSseStream(response.body), { status: response.status, statusText: response.statusText, headers })
  }
}
