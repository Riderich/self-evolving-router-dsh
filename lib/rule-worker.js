import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { snapshot } from './executor.js'
import { assert } from './schema.js'
import { hash, ruleConfig, triggerResult, executionResult } from './rule-contract.js'
import { materializePackage, checkPackage } from './rule-package.js'

export async function treeHash(root, signal) {
  const rows = []
  async function walk(dir, prefix = '') {
    for (const n of (await readdir(dir)).sort()) {
      signal?.throwIfAborted()
      const p = join(dir, n), st = await lstat(p)
      assert(!st.isSymbolicLink(), 'Snapshot link')
      if (st.isDirectory()) { rows.push([prefix + n + '/', null]); await walk(p, prefix + n + '/') }
      else { assert(st.isFile(), 'Snapshot special file'); rows.push([prefix + n, (await readFile(p)).toString('base64')]) }
    }
  }
  await walk(root); return hash(rows)
}
export async function requestSnapshot(root, config, signal) {
  const path = await snapshot(root, config.snapshotDirectory, signal)
  try { return { path, id: await treeHash(path, signal), dispose: () => rm(path, { recursive: true, force: true }) } }
  catch (e) { await rm(path, { recursive: true, force: true }); throw e }
}
export function processOutput(command, args, { input = '', timeoutMs = 10000, maxOutputBytes = 65536, signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const p = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []; let size = 0, failure
    const stop = message => { failure ??= Error(message); p.kill('SIGKILL') }
    const abort = () => stop('Execution aborted')
    const timer = setTimeout(() => stop('Execution timeout'), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    for (const [s, rows] of [[p.stdout, out], [p.stderr, err]]) s.on('data', b => { size += b.length; if (size > maxOutputBytes) stop('Output limit exceeded'); else rows.push(b) })
    p.once('error', e => { failure = e })
    p.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (failure) { failure.processOutput = {stdout: Buffer.concat(out).toString('utf8'),stderr: Buffer.concat(err).toString('utf8'),exitCode:code}; reject(failure) }
      else resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), exitCode: code })
    })
    p.stdin.on('error', () => {}); p.stdin.end(input)
  })
}
// The wrapper, imports and all module initialization execute inside the container.
const wrapper = `import sys,json,runpy,platform
if platform.python_version() != sys.argv[1]: raise RuntimeError('Python environment drift')
payload=json.load(sys.stdin)
sys.path.insert(0,'/rule')
namespace=runpy.run_path('/rule/'+sys.argv[2]+'.py')
if sys.argv[2]=='trigger':
 result=namespace['trigger'](payload['request'],payload['context'])
else:
 result=namespace['execute'](payload['request'],payload['args'],payload['context'])
print(json.dumps(result,allow_nan=False,separators=(',',':')))
`
export class RuleWorker {
  async run(pkg, phase, payload, config, snap, signal) {
    const c = ruleConfig(config), checked = checkPackage({ files: pkg.files, revision: pkg.revision })
    assert(['trigger', 'executor'].includes(phase) && c.image && c.pythonVersion, 'Unpinned/invalid execution')
    assert(Buffer.byteLength(JSON.stringify(payload)) <= 65536, 'Input limit exceeded')
    const started = performance.now(), dir = await materializePackage(checked, c.snapshotDirectory)
    const name = `dsh-rule-${randomUUID()}`, prefix = c.dockerContext ? ['--context', c.dockerContext] : []
    let output, failure, cleanupError
    try {
      const mounts = ['--mount', `type=bind,source=${dir.path},target=/rule,readonly`]
      assert(!dir.path.includes(','), 'Unsupported mount path')
      if (phase === 'executor') {
        assert(snap && !snap.path.includes(',') && await treeHash(snap.path, signal) === snap.id, 'Snapshot changed')
        mounts.push('--mount', `type=bind,source=${snap.path},target=/testbed,readonly`)
      }
      output = await processOutput(c.dockerCommand, [...prefix, 'run', '--rm', '--pull=never', '--name', name,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', String(c.pids), '--memory', `${c.memoryMb}m`, '--cpus', String(c.cpus), '--user', '65534:65534',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m', ...mounts, '--workdir', phase === 'executor' ? '/testbed' : '/rule',
        '--env', 'LC_ALL=C', '--env', 'TZ=UTC', '--entrypoint', 'python3', '-i', c.image, '-I', '-B', '-c', wrapper, c.pythonVersion, phase],
      { input: JSON.stringify(payload), timeoutMs: phase === 'trigger' ? c.triggerTimeoutMs : c.executionTimeoutMs, maxOutputBytes: c.maxOutputBytes, signal })
      if (output.exitCode !== 0) {
        const error = Error(`Worker exited ${output.exitCode}: ${output.stderr.slice(0, 1000)}`)
        error.kind = [125, 126, 127].includes(output.exitCode) || /Python environment drift/.test(output.stderr) ? 'environment-error' : 'program-error'
        throw error
      }
      if (phase === 'executor') assert(await treeHash(snap.path, signal) === snap.id, 'Snapshot changed during execution')
      const r = JSON.parse(output.stdout)
      output.result = phase === 'trigger' ? triggerResult(r, checked.manifest) : executionResult(r, checked.manifest)
    } catch (e) { failure = e; output ??= e.processOutput }
    finally {
      try {
        const removed = await processOutput(c.dockerCommand, [...prefix, 'rm', '-f', name], { timeoutMs: 5000 })
        assert(removed.exitCode === 0 || /No such container/i.test(removed.stderr), 'Container cleanup failed')
      } catch (e) { cleanupError = e }
      // Do not delete a mounted package if the runtime could not confirm cleanup.
      if (!cleanupError) await dir.dispose()
    }
    if (failure || cleanupError) {
      const e = failure ?? cleanupError
      e.telemetry = { phase, errorKind: cleanupError || e.code === 'ENOENT' ? 'environment-error' : e.kind ?? 'program-error', durationMs: performance.now() - started, stdout: output?.stdout ?? null, stderr: output?.stderr ?? null, cleanupError: cleanupError?.message ?? null }
      throw e
    }
    return { ...output, phase, durationMs: performance.now() - started }
  }
}
