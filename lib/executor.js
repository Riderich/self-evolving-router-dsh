import { spawn } from 'node:child_process'
import { mkdtemp, readdir, lstat, copyFile, mkdir, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { assert } from './schema.js'

export async function snapshot(root, directory = tmpdir(), signal) {
  signal?.throwIfAborted()
  await mkdir(directory, { recursive: true })
  const dest = await mkdtemp(join(directory, 'dsh-router-'))
  await chmod(dest, 0o755)
  let bytes = 0, count = 0
  async function copy(from, to) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      signal?.throwIfAborted()
      // Hidden/private files and links are intentionally outside this execution view.
      if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name)) continue
      const src = join(from, entry.name), dst = join(to, entry.name), st = await lstat(src)
      assert(++count <= 10000 && (bytes += st.isFile() ? st.size : 0) <= 32 * 1024 * 1024, 'Workspace snapshot exceeds safety limits')
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) { await mkdir(dst, { mode: 0o755 }); await copy(src, dst) }
      else if (st.isFile()) { await copyFile(src, dst); await chmod(dst, 0o644) }
    }
  }
  try { await copy(root, dest); signal?.throwIfAborted(); return dest } catch (e) { await rm(dest, { recursive: true, force: true }); throw e }
}
export class DockerExecutor {
  async execute(candidate, args, root, config, signal) {
    assert(/^sha256:[a-f0-9]{64}$/.test(config.image) || /@sha256:[a-f0-9]{64}$/.test(config.image), 'Configure an immutable local image ID/digest')
    const started = performance.now(), directory = await snapshot(root, config.snapshotDirectory)
    const name = `dsh-router-${randomUUID()}`
    const prefix = config.dockerContext ? ['--context', config.dockerContext] : []
    assert(!directory.includes(','), 'Unsupported mount path')
    try {
      const output = await new Promise((resolve, reject) => {
        signal?.throwIfAborted()
        const child = spawn(config.dockerCommand, [...prefix, 'run', '--rm', '--pull=never', '--name', name,
          '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--pids-limit', '64', '--memory', '128m', '--cpus', '1', '--user', '65534:65534',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m', '--mount', `type=bind,source=${directory},target=/testbed,readonly`,
          '--workdir', '/testbed', '-i', config.image, '/bin/sh', '-s', '--', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
        let stdout = '', stderr = '', size = 0, failure
        const stop = reason => { failure ??= new Error(reason); child.kill('SIGKILL') }
        const abort = () => stop('Execution aborted')
        const timer = setTimeout(() => stop('Execution timeout'), config.timeoutMs)
        signal?.addEventListener('abort', abort, { once: true })
        for (const [stream, kind] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', b => {
          size += b.length
          if (size > config.maxOutputBytes) return stop('Output limit exceeded')
          if (kind === 'out') stdout += b.toString(); else stderr += b.toString()
        })
        child.once('error', e => { failure = e })
        child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); failure ? reject(failure) : resolve({ stdout, stderr, exitCode: code }) })
        child.stdin.on('error', () => {})
        child.stdin.end(`set -eu\n${candidate.requires.map(x => `command -v '${x}' >/dev/null`).join('\n')}\n${candidate.script}\n`)
      })
      return { ...output, durationMs: performance.now() - started }
    } finally {
      // A killed Docker client may leave its container running. Never leave it behind.
      await new Promise(resolve => {
        const p = spawn(config.dockerCommand, [...prefix, 'rm', '-f', name], { stdio: 'ignore' })
        const timer = setTimeout(() => { p.kill('SIGKILL'); resolve() }, 5000)
        p.on('error', () => { clearTimeout(timer); resolve() }); p.on('close', () => { clearTimeout(timer); resolve() })
      })
      await rm(directory, { recursive: true, force: true })
    }
  }
}
