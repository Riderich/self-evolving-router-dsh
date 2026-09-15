import {CapabilityStore} from './lib/v2/core.js'
import { MaintenanceController } from './lib/maintenance-controller.js'
import { dshMaintenanceRunner } from './lib/maintenance-runner.js'
import { observeVerified } from './lib/maintenance-state.js'
import { realpath } from 'node:fs/promises'
import { Router } from './lib/runtime.js'
import { attachAgent, createModel } from './lib/dsh-adapter.js'
import { metrics } from './lib/metrics.js'
import { RuleStore } from './lib/rule-store.js'
import { RuleRegistry } from './lib/rule-registry.js'
import { event } from './lib/store.js'

export const name = 'dsh-prellm-router'
export const inject = ['agents', 'sessions', 'llm', 'agentDefaultModel', 'commands']
export function apply(ctx, config = {}) {
  const routers = new Map(), restores = [], turns = new Map(), tasks = new Set(), abort = new AbortController()
  let closed = false
  const track = promise => { tasks.add(promise); promise.catch(e => ctx.logger?.warn?.(`router: ${e.message}`)).finally(() => tasks.delete(promise)); return promise }
  const get = async cwd => {
    const root = await realpath(cwd)
    if (!routers.has(root)) routers.set(root, config.createRouter ? config.createRouter(root, createModel(ctx)) : new Router(root, { model: createModel(ctx) }))
    return routers.get(root)
  }
  // Attach synchronously before the factory can begin its first turn.
  const install = agent => {
    try { restores.push(attachAgent(agent, { route: async (text, signal) => {
      try { return await (await get(agent.session.header.cwd)).route(text, signal) }
      catch { return { kind: 'fallback', reason: 'workspace-unavailable' } }
    } })) } catch (e) { ctx.logger?.warn?.(`router not attached: ${e.message}`) }
  }
  const offCreated = ctx.on('agent/created', ({ agent }) => install(agent))
  // Existing agents are supported when the plugin is loaded after the factory.
  if (typeof ctx.agents.list === 'function') for (const agent of ctx.agents.list()) install(agent)
  // Await the bounded learning job before the headless app disposes its model service.
  // The assistant response has already been emitted; this maintenance time is accounted.
  const offStopping = ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const turn = turns.get(agent.session.id)
    if (closed || !turn || turn.learned || turn.routed || turn.failed || !turn.request) return
    turn.learned = true
    try {
      const router = await get(agent.session.header.cwd)
      // Object maintenance uses its own provenance and operations; never run
      // the legacy template learner for an object-backend fallback.
      if (await new CapabilityStore(router.store.root).exists() || await new RuleStore(router.store.root).exists()) return
      if (!(await router.store.read()).config.enabled) return
      await router.record(turn)
      await router.learn(AbortSignal.any([signal, abort.signal]))
    } catch (e) { ctx.logger?.warn?.(`router maintenance: ${e.message}`) }
  })
  const offEvent = ctx.on('session/event', (session, e) => {
    if (closed) return
    const key = session.id
    if (e.type === 'turn/start') turns.set(key, { request: '', output: '', routed: false, failed: false, started: performance.now(), modelMessages: 0, usage: { inputTokens: 0, outputTokens: 0 } })
    const turn = turns.get(key)
    if (!turn) return
    if (e.type === 'user/message' && e.data.source?.kind === 'user') turn.request = e.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (e.type === 'assistant/message') {
      turn.routed ||= e.data.message.source?.provider === 'dsh-prellm-router'
      if (e.data.message.source?.provider !== 'dsh-prellm-router') turn.modelMessages++
      turn.output = e.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('')
      turn.usage.inputTokens += e.data.usage?.inputTokens ?? 0; turn.usage.outputTokens += e.data.usage?.outputTokens ?? 0
      for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) turn.usage[key] = (turn.usage[key] ?? 0) + (e.data.usage?.[key] ?? 0)
    }
    if (e.type === 'tool/result' && (e.data.error || e.data.message?.content?.some(b => b.isError))) turn.failed = true
    if (e.type === 'turn/end') {
      turns.delete(key)
      track((async () => {
        const router = await get(session.header.cwd)
        const caps=new CapabilityStore(router.store.root)
        if(await caps.exists()){await caps.transaction(s=>event(s,'capability-agent-turn',{sessionId:key,routed:turn.routed,modelMessages:turn.modelMessages,usage:turn.usage,durationMs:performance.now()-turn.started}));return}
        const objects = new RuleStore(router.store.root)
        if (await objects.exists()) {
          await objects.transaction(s => event(s, 'object-agent-turn', { sessionId: key, turn: e.data.turn, reason: e.data.reason?.kind, routed: turn.routed, modelMessages: turn.modelMessages, usage: turn.usage, usageSemantics: 'dsh-disjoint-v1', durationMs: performance.now() - turn.started }))
          return
        }
        if (!(await router.store.read()).config.enabled) return
        await router.observeTurn({ sessionId: key, turn: e.data.turn, reason: e.data.reason?.kind, routed: turn.routed, modelMessages: turn.modelMessages, usage: turn.usage, usageSemantics: 'dsh-disjoint-v1', durationMs: performance.now() - turn.started })
      })())
    }
  })
  const offCommand = ctx.commands.register({ name: 'router', description: 'Manage deterministic pre-LLM routing', input: { hint: 'status | enable | disable | learn | programs | retire ID | rollback ID' },
    async handler(invocation) {
      try {
        const router = await get(invocation.agent.session.header.cwd), [action = 'status', value] = invocation.rawInput.trim().split(/\s+/)
        let result
        const objects = new RuleStore(router.store.root)
        if (await objects.exists()) {
          const s = await objects.read(), registry = new RuleRegistry(objects)
          if (action === 'enable' || action === 'disable') result = await objects.configure({ enabled: action === 'enable' })
          else if (action === 'retire') result = await registry.disable(value, s.generation)
          else if (action === 'learn') {
            const controller = new MaintenanceController(objects, dshMaintenanceRunner(objects));
            const chain = await controller.next(); result = chain ? await controller.run(chain.id) : { status: 'idle' }
          }
          else if (action === 'rollback') throw Error('Object rollback requires explicit revision and generation via cli.js')
          else result = { backend: s.backend, generation: s.generation, config: s.config, active: s.active, ...(action === 'programs' ? { packages: s.packages, proofs: s.proofs } : action === 'metrics' ? { events: s.events } : {}) }
          return { kind: 'success', text: JSON.stringify(result, null, 2) }
        }
        if (action === 'enable' || action === 'disable') result = await router.store.configure({ enabled: action === 'enable' })
        else if (action === 'learn') result = await router.learn(invocation.signal)
        else if (action === 'retire' || action === 'rollback') result = await router.retire(value, action === 'rollback')
        else { const s = await router.store.read(); result = action === 'programs' ? { active: s.active, candidates: s.candidates } : action === 'metrics' ? metrics(s) : { config: s.config, active: s.active, history: s.history.length, budget: s.budget, stats: s.stats } }
        return { kind: 'success', text: JSON.stringify(result, null, 2) }
      } catch (e) { return { kind: 'error', text: e.message } }
    },
  })
  ctx.provide('prellmRouter', { ready: true,
    // This service is for trusted host evaluators, never an agent tool. A normal
    // assistant answer is deliberately insufficient to certify task success.
    async observeVerified(cwd, evidence) {
      const store = new RuleStore(await realpath(cwd));
      await observeVerified(store, evidence);
      const controller = new MaintenanceController(store, dshMaintenanceRunner(store));
      const chain = await controller.next();
      return chain ? track(controller.run(chain.id)) : { status: 'idle' }
    },
  })
  return async () => { closed = true; abort.abort(); offCreated(); offStopping(); offEvent(); offCommand(); for (const restore of restores) restore(); await Promise.allSettled([...tasks]) }
}
