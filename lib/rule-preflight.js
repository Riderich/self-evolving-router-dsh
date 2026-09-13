import { dshRuntime } from './dsh-runtime.js'
import { readFile, access, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { processOutput } from './rule-worker.js'
import { ruleConfig, hash } from './rule-contract.js'
export async function preflight(raw, { docker = true } = {}) {
  const checks = [], config = ruleConfig(raw)
  const record = async (name, fn) => { try { checks.push({ name, ok: true, detail: await fn() }) } catch (e) { checks.push({ name, ok: false, error: e.message }) } }
  await record('node', () => { if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node >=22 required'); return process.version })
  await record('dsh-pin', async () => {
    return (await dshRuntime()).version
  })
  await record('router-profile', async () => { await access(join((await dshRuntime()).home, 'profiles/router/node_modules/dsh-prellm-router/index.js')); return 'installed' })
  await record('object-entrypoints', async () => {
    for (const file of ['../cli.js', '../install.js', './rule-contract.js', './rule-package.js', './rule-worker.js', './rule-router.js', './rule-store.js', './rule-registry.js', './rule-validation.js']) await access(new URL(file, import.meta.url))
    return 'present'
  })
  if (docker) await record('isolated-python', async () => {
    if (!config.image || !config.pythonVersion) throw Error('Pin image and pythonVersion first')
    const prefix = config.dockerContext ? ['--context', config.dockerContext] : []
    const result = await processOutput(config.dockerCommand, [...prefix, 'run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--memory', '128m', '--cpus', '1', '--user', '65534:65534', '--entrypoint', 'python3', config.image, '-I', '-B', '--version'])
    if (result.exitCode !== 0 || result.stdout.trim() !== `Python ${config.pythonVersion}`) throw Error(`Runtime unavailable/drift: ${result.stderr || result.stdout}`)
    return result.stdout.trim()
  })
  return { backend: config.backend, configHash: hash(config), checkedAt: new Date().toISOString(), ready: checks.every(c => c.ok), runtimeTested: docker, checks, modelCalls: 0 }
}
