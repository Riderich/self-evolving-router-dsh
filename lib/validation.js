import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { bind } from './matcher.js'
import { assert, digest, POLICY, sensitive } from './schema.js'

const feedback = value => sensitive(JSON.stringify(value)) ? '[withheld-sensitive]' : typeof value === 'string' ? value.slice(0, 2048) : value

export async function loadSuite(store) {
  const suite = JSON.parse(await readFile(join(store.dir, 'evals.json'), 'utf8'))
  assert(suite.version === 1 && Array.isArray(suite.cases), 'Invalid trusted evaluation suite')
  return suite
}
export async function validate(candidate, store, executor, config, signal) {
  const started = performance.now()
  const suite = await loadSuite(store)
  const cases = suite.cases.filter(c => c.programId === candidate.id)
  assert(cases.length <= config.maxValidationCases, 'Too many validation cases')
  assert(cases.filter(c => c.route === true).length >= 2 && cases.filter(c => c.route === false).length >= 2, 'Need at least two positive and two boundary cases per program')
  const results = []
  for (const c of cases) {
    assert(typeof c.id === 'string' && typeof c.request === 'string' && typeof c.route === 'boolean', 'Malformed evaluation case')
    const root = await mkdtemp(join(tmpdir(), 'dsh-router-eval-'))
    try {
      for (const [path, contents] of Object.entries(c.files ?? {})) {
        assert(!path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.')) && !path.includes('\\'), 'Unsafe fixture path')
        assert(typeof contents === 'string' && contents.length < 1048576, 'Invalid fixture')
        await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), contents)
      }
      const bindingDiagnostics = []
      const args = await bind(candidate, c.request, root, bindingDiagnostics)
      const details = { id: c.id, request: feedback(c.request), expectedRoute: c.route, args: feedback(args) }
      if (!c.route) results.push({ ...details, passed: args === null, category: args === null ? 'boundary-pass' : 'incorrect-route' })
      else if (!args) results.push({ ...details, passed: false, category: 'binding-miss', bindingDiagnostics: feedback(bindingDiagnostics) })
      else {
        assert(typeof c.expected?.stdout === 'string' && Number.isInteger(c.expected?.exitCode), 'Positive case needs trusted expected output')
        const result = await executor.execute(candidate, args, root, config, signal)
        const passed = result.stdout === c.expected.stdout && result.exitCode === c.expected.exitCode && result.stderr === (c.expected.stderr ?? '')
        results.push({ ...details, passed, category: passed ? 'execution-pass' : 'output-mismatch',
          expected: { stdout: feedback(c.expected.stdout), stderr: feedback(c.expected.stderr ?? ''), exitCode: c.expected.exitCode },
          actual: { stdout: feedback(result.stdout), stderr: feedback(result.stderr), exitCode: result.exitCode }, durationMs: result.durationMs })
      }
    } catch (error) {
      results.push({ id: c.id, passed: false, category: 'validation-error', error: feedback(error.message) })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  return { passed: results.every(x => x.passed), results, suiteHash: digest(suite), candidateHash: digest(candidate), image: config.image, policy: POLICY, time: new Date().toISOString(), durationMs: performance.now() - started }
}
