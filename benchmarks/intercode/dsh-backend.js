// Explicit benchmark-only tool overlay. Never enabled in normal router sessions.
import { appendFile, readFile, realpath } from 'node:fs/promises'
import { resolve, posix, join } from 'node:path'
import { DockerExecutor } from '../../lib/executor.js'
import { validateConfig } from '../../lib/schema.js'
import { RuleStore } from '../../lib/rule-store.js'
export const name = 'intercode-readonly-backend'
export const inject = ['tools', 'systemPrompt']

export function workdir(value, root) {
  if (value === undefined || value === root) return '/testbed'
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) throw Error('Invalid benchmark workdir')
  const path = posix.resolve('/testbed', value)
  if (path !== '/testbed' && !path.startsWith('/testbed/')) throw Error('Benchmark workdir must be inside /testbed')
  return path
}
export async function loadBackend(path) {
  const input = JSON.parse(await readFile(path, 'utf8'))
  const root = await realpath(process.cwd())
  if (await realpath(input.root) !== root) throw Error('Benchmark root must match session cwd')
  const objects = new RuleStore(root)
  let config
  if (await objects.exists()) {
    const state = await objects.read(), c = state.config
    if (state.maintenance?.config?.enabled) throw Error('Benchmark request sessions require maintenance disabled')
    // DockerExecutor and RuleWorker expose the same public snapshot and image.
    // DockerExecutor fixes these resources; reject mismatched comparisons.
    if (c.memoryMb !== 128 || c.cpus !== 1 || c.pids !== 64) throw Error('Benchmark resource limits must match executor')
    config = validateConfig({ image: c.image, dockerCommand: c.dockerCommand, dockerContext: c.dockerContext,
      snapshotDirectory: c.snapshotDirectory, timeoutMs: c.executionTimeoutMs, maxOutputBytes: c.maxOutputBytes, learning: false })
  } else {
    const state = JSON.parse(await readFile(join(root, '.dsh/prellm-router/state.json'), 'utf8'))
    config = validateConfig(state.config)
  }
  if (config.image !== input.image || config.learning) throw Error('Benchmark requires matching pinned image and learning:false')
  const journal = resolve(input.journal)
  if (journal === root || journal.startsWith(root + '/')) throw Error('Benchmark journal must be outside exposed workspace')
  if (input.answerContract !== undefined && input.answerContract !== 'integer-only') throw Error('Unsupported benchmark answer contract')
  return { root, config, journal, answerContract: input.answerContract }
}
export function apply(ctx, settings) {
  const executor = new DockerExecutor(), installed = new WeakMap()
  const record = event => appendFile(settings.journal, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 })
  // A monotonic execution guard is the authority boundary, not catalog visibility.
  ctx.tools.guard(exec => {
    const body = exec.agent && installed.get(exec.agent)
    if (exec.name !== 'bash' || !body || ctx.tools.get('bash', exec.agent)?.execute !== body) return 'Benchmark denies non-isolated tool execution'
  })
  ctx.systemPrompt.section({ name: 'benchmark:readonly', order: 999, text: 'This is a read-only Bash benchmark. The bash tool runs in a fresh isolated Linux container per call with working directory /testbed. Only public workspace files are exposed; /tmp is ephemeral. No host credentials, host files, internet, persistent writes or background jobs are available. Use absolute /testbed paths. Return only the requested result, without commentary or Markdown. Do not assume shell state persists across calls.' })
  if (settings.answerContract === 'integer-only') ctx.systemPrompt.section({ name: 'benchmark:answer-contract', order: 1000, text: 'MANDATORY OUTPUT INTERFACE for this count-only task family: your entire final assistant response MUST consist of exactly one nonnegative integer, optionally followed by a newline. No other words, labels, punctuation, Markdown, filenames, code blocks, or explanation. Execute the task using bash, then return only the integer you computed. The evaluator requires this exact interface.' })
  ctx.on('agent/created', ({ agent }) => {
    const original = ctx.tools.get('bash')
    if (!original) throw Error('Pinned native bash tool must be registered before benchmark agent')
    agent.ctx.tools.restrict({ allow: ['bash'] })
    const execute = async (args, exec) => {
      if (typeof args.command !== 'string' || !args.command || args.command.length > 16384 || args.command.includes('\0')) throw Error('Invalid benchmark command')
      if (args.run_in_background || args.sandbox_permissions !== undefined) throw Error('No background execution or sandbox escalation in benchmark')
      const cwd = workdir(args.workdir, settings.root)
      const timeoutMs = args.timeoutMs === undefined ? settings.config.timeoutMs : Math.min(settings.config.timeoutMs, args.timeoutMs)
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('Invalid command timeout')
      await record({ type: 'tool-start', callId: exec.callId, command: args.command, workdir: cwd })
      let result
      try {
        result = await executor.execute({ requires: ['bash'], script: '#!/bin/sh\ncd "$2"\nexec /bin/bash --noprofile --norc -c "$1"' }, [args.command, cwd], settings.root, { ...settings.config, timeoutMs }, exec.signal)
      } catch (error) { await record({ type: 'tool-error', callId: exec.callId, error: error.message }); throw error }
      await record({ type: 'tool-end', callId: exec.callId, ...result })
      return { kind: 'foreground', exitCode: result.exitCode, signal: null, timedOut: false, aborted: false, timeoutMs,
        stdout: { text: result.stdout, truncated: false }, stderr: { text: result.stderr, truncated: false } }
    }
    agent.ctx.tools.register({ ...original, execute })
    installed.set(agent, execute)
    const schemas = ctx.tools.schemas(agent)
    if (schemas.length !== 1 || schemas[0].name !== 'bash') throw Error('Benchmark tool catalog is not bash-only')
  })
  ctx.provide('benchmarkBackend', { ready: true })
}
