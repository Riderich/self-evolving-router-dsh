#!/usr/bin/env node
// Boots the installed DSH profile through its public boot API. This avoids the
// CLI's repeated dependency-closure healing on cloud-placeholder files; it does
// not implement an agent loop. Use install.js first on the prepared runtime.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { writeFile, realpath, readFile, lstat } from 'node:fs/promises'
import { installGatewayCompatibility } from './lib/sse-compat.js'
import * as benchmarkPlugin from './benchmarks/intercode/dsh-backend.js'
import { Router } from './lib/runtime.js'
import { createModel } from './lib/dsh-adapter.js'
import { providerPatches } from './lib/provider-config.js'
import { dshRuntime } from './lib/dsh-runtime.js'
import * as maintenancePlugin from './lib/maintenance-plugin.js'
import { RuleStore } from './lib/rule-store.js'
const args = process.argv.slice(2)
let maintenance
const maintenanceIndex = args.indexOf('--object-maintenance-file')
if (maintenanceIndex >= 0) { maintenance = JSON.parse(await readFile(resolve(args[maintenanceIndex + 1]), 'utf8')); args.splice(maintenanceIndex, 2) }
let provider
const providerIndex = args.indexOf('--provider-file')
if (providerIndex >= 0) {
  provider = JSON.parse(await readFile(resolve(args[providerIndex + 1] ?? ''), 'utf8'))
  args.splice(providerIndex, 2)
}
const learnIndex = args.indexOf('--benchmark-learn-only')
const learnOnly = learnIndex >= 0
if (learnOnly) args.splice(learnIndex, 1)
let benchmark
const benchmarkIndex = args.indexOf('--benchmark-file')
if (benchmarkIndex >= 0) {
  const { loadBackend } = await import('./benchmarks/intercode/dsh-backend.js')
  benchmark = await loadBackend(resolve(args[benchmarkIndex + 1] ?? ''))
  args.splice(benchmarkIndex, 2)
}
if (learnOnly && !benchmark) throw Error('Explicit benchmark config required for maintenance-only mode')
// headlessStartup validates a positional task even when its runner is disabled.
// This placeholder is never submitted to an agent or sent to the provider.
if (learnOnly) args.push('benchmark maintenance only')
let connection
if (args[0] === '--auth-file') {
  const path = resolve(args[1] ?? '')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Auth file must be a private regular file (chmod 600)')
  connection = JSON.parse(await readFile(path, 'utf8'))
  if (typeof connection.apiKey !== 'string' || !connection.apiKey || typeof connection.baseURL !== 'string' || !connection.baseURL.startsWith('https://')) throw new Error('Auth file requires apiKey and an HTTPS baseURL')
  process.env.DEEPSEEK_API_KEY = connection.apiKey
  installGatewayCompatibility(connection.baseURL)
  args.splice(0, 2)
}
const { anchor, require, home } = await dshRuntime()
process.env.DSH_HOME ??= home
process.env.DSH_TELEMETRY_DISABLED = '1'
const { boot, loadProfile } = await import(require.resolve('@deepseek-ai/dsh-app-boot'))
const { provideCmdline } = await import(require.resolve('@deepseek-ai/dsh-cmdline'))
const { DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } = await import(require.resolve('@deepseek-ai/dsh-launch-environment'))
const profile = loadProfile('dsh', 'router', anchor, process.env.DSH_HOME)
const root = join(profile.dir, 'cordis.yml')
try { await writeFile(root, '[]\n', { flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }
const patches = [...profile.layers.flatMap(l => l.patches), ...profile.patches, { id: 'session-telemetry-otel', disabled: true }]
if (benchmark) patches.push({ id: 'headless-runner', inject: ['headlessStartup', 'prellmRouter', 'benchmarkBackend'] }, { id: 'tool-bash', config: { enableRunInBackground: false } })
if (maintenance) {
  if (benchmark || learnOnly) throw Error('Maintenance and benchmark sessions must be separate')
  maintenance = { ...maintenance, defineTool: (await import(require.resolve('@deepseek-ai/dsh-tools'))).defineTool, prompt: await maintenancePlugin.maintenancePrompt(new RuleStore(maintenance.root), maintenance.chain_id) }
  patches.push({ id: 'headless-runner', inject: ['headlessStartup', 'objectMaintenance'] }, { id: 'prellm-router', disabled: true })
}
if (learnOnly) patches.push({ id: 'headless-runner', disabled: true })
if (provider && !connection) throw Error('Explicit auth file required with provider file')
if (connection) patches.push(...providerPatches(provider ?? { adapter: 'deepseek-native', model: connection.model ?? 'deepseek-v4-flash' }, connection.baseURL))
let context, shutdown
const stop = code => {
  process.exitCode = code
  return shutdown ??= Promise.resolve().then(() => context?.fiber.dispose())
}
process.once('SIGINT', () => { void stop(130) }); process.once('SIGTERM', () => { void stop(143) })
try {
  await boot('dsh-router', root, patches, ctx => {
    context = ctx
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env } }]))
    provideCmdline(ctx, { args, exit: code => { void stop(code) } })
    if (benchmark) ctx.plugin(benchmarkPlugin, benchmark)
    if (maintenance) ctx.plugin(maintenancePlugin, maintenance)
    if (learnOnly) ctx.plugin({ name: 'benchmark-maintenance-only', inject: ['llm', 'agentDefaultModel', 'prellmRouter', 'benchmarkBackend'], apply(services) {
      // No agent request is submitted. The external controller admits only past
      // oracle-checked history; synthesis still uses the real pinned DSH adapter.
      queueMicrotask(async () => {
        const router = new Router(benchmark.root, { model: createModel(services) })
        let code = 0
        try { await router.store.configure({ learning: true }); console.log(JSON.stringify(await router.learn())) }
        catch (error) { console.error(error.message); code = 1 }
        finally { await router.store.configure({ learning: false }); await stop(code) }
      })
    } })
  })
  if (shutdown) await shutdown
} catch (e) { console.error(e.message); await stop(1) }
