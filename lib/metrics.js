export function metrics(state) {
  const events = state.events, count = type => events.filter(e => e.type === type).length
  const turns = events.filter(e => e.type === 'agent-turn'), routes = events.filter(e => e.type === 'route-decision')
  const sum = (rows, field) => rows.reduce((n, r) => n + (r[field] ?? 0), 0)
  const synthesis = events.filter(e => e.type === 'synthesis-end')
  const failedCallMs = events.filter(e => e.type === 'synthesis-error').reduce((n, e) => n + (e.modelCallDurationMs ?? 0), 0)
  const validation = events.filter(e => e.type === 'validation')
  const aggregateUsage = rows => {
    const usage = Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(k => [k, rows.reduce((n, r) => n + (r?.[k] ?? 0), 0)]))
    usage.totalInputTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    return usage
  }
  const baseUsage = aggregateUsage(turns.map(t => t.usage))
  const learningUsage = aggregateUsage(Object.values(state.budget))
  return { requests: routes.length, routed: routes.filter(r => r.kind === 'completed').length, fallbacks: routes.filter(r => r.kind === 'fallback').length,
    agentTurns: turns.length, observedBaseModelMessages: sum(turns, 'modelMessages'), baseUsage, learningUsage,
    learningCallsReserved: Object.values(state.budget).reduce((n, b) => n + b.calls, 0), learningErrors: count('synthesis-error'),
    durationMs: { agentTurns: sum(turns, 'durationMs'), routingIncludingExecution: sum(routes, 'durationMs'), synthesis: sum(synthesis, 'durationMs') + failedCallMs, validation: validation.reduce((n, e) => n + (e.proof.durationMs ?? 0), 0) },
    promotions: count('promote'), circuitOpens: count('circuit-open'),
    caveats: ['DSH inputTokens is UNCACHED input; totalInputTokens includes cache reads/writes. Older logs may lack retained cache fields.', 'Durations overlap: agent-turn time includes routing. Do not add these columns.', 'Missing provider usage is unknown, not free. Failed/aborted calls may lack usage.', 'Route completion is not oracle-verified task success. Dollar savings and correctness require external benchmark/accounting.'] }
}
