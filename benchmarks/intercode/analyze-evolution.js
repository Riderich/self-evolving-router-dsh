// Post-run audit only: never calls a model or modifies experimental registries.
import { readFile, writeFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Router } from '../../lib/runtime.js'
import { bind, parseTemplate } from '../../lib/matcher.js'
import { DockerExecutor } from '../../lib/executor.js'
import { fixtureFiles, expected } from './protocol.js'
const output = await realpath(process.argv[2]), report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
if (!report.completed) throw Error('Requires completed experiment')
const network = (await readFile(join(output, 'network.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
const requests = network.filter(e => e.type === 'request'), responses = network.filter(e => ['response', 'response-error'].includes(e.type))
const audit = { experiment: output, time: new Date().toISOString(), physicalRequests: requests.length, priorAttemptRequests: report.previousAttemptHTTPRequests, modelCallBudget: 64,
  totalDevelopmentRequests: requests.length + report.previousAttemptHTTPRequests, rows: {}, responsesWithUsage: 0, missingUsageRequestIds: [], rawUsage: { prompt: 0, completion: 0 },
  allFixtureChecksPassed: report.runs.every(r => r.sourceUnchanged), allAnswersCorrect: report.runs.every(r => r.correct), diagnostics: [],
  diagnosticWarning: 'Post hoc fault localization, not additional scored tasks. Original candidates are unchanged. Forced-argument executions bypass only routing to separate trigger failures from program failures. No promotion or learner feedback.' }
for (const request of requests) {
  const response = responses.find(r => r.id === request.id)
  const chunks = String(response?.body ?? response?.partialBody ?? '').split('\n').filter(l => l.startsWith('data: ')).map(l => { try { return JSON.parse(l.slice(6)) } catch { return null } })
  const usage = chunks.filter(x => x?.usage).at(-1)?.usage
  if (!usage) audit.missingUsageRequestIds.push(request.id)
  else { audit.responsesWithUsage++; audit.rawUsage.prompt += usage.prompt_tokens ?? 0; audit.rawUsage.completion += usage.completion_tokens ?? 0 }
}
for (const [condition, s] of Object.entries(report.summary)) {
  const b = s.metrics.baseUsage, l = s.metrics.learningUsage
  audit.rows[condition] = { original: s.original, probes: s.probes, logicalCalls: s.logicalHTTPRequests, baseCalls: s.metrics.observedBaseModelMessages, synthesisCalls: s.metrics.learningCallsReserved,
    uncachedInput: b.inputTokens + l.inputTokens, cachedInput: b.cacheReadTokens + l.cacheReadTokens, cacheWrite: b.cacheWriteTokens + l.cacheWriteTokens,
    output: b.outputTokens + l.outputTokens, totalTokens: b.totalInputTokens + l.totalInputTokens + b.outputTokens + l.outputTokens,
    lifecycleSeconds: s.lifecycleWallMs / 1000, totalSeconds: s.totalWallMs / 1000 }
}
const [b0, b2, b3, b4] = ['B0', 'B2', 'B3', 'B4'].map(k => audit.rows[k])
audit.comparisons = { evolvingVsFrozen: { extraTokens: b4.totalTokens - b3.totalTokens, extraTotalSeconds: b4.totalSeconds - b3.totalSeconds,
  tokenPercent: 100 * (b4.totalTokens / b3.totalTokens - 1), timePercent: 100 * (b4.totalSeconds / b3.totalSeconds - 1), additionalCorrectRoutes: b4.original.correctRouted + b4.probes.correctRouted - b3.original.correctRouted - b3.probes.correctRouted },
  evolvingVsAlways: { tokenPercent: 100 * (b4.totalTokens / b0.totalTokens - 1), timePercent: 100 * (b4.totalSeconds / b0.totalSeconds - 1) },
  templatesVsAlways: { tokenSavingsPercent: 100 * (1 - b2.totalTokens / b0.totalTokens), timeSavingsPercent: 100 * (1 - b2.totalSeconds / b0.totalSeconds) } }
const prefixRows = report.runs.filter(r => r.condition === 'B0' && [20, 22, 28].includes(r.index))
const sumUsage = rows => rows.reduce((sum, r) => ({ input: sum.input + (r.turn.usage.inputTokens ?? 0) + (r.turn.usage.cacheReadTokens ?? 0) + (r.turn.usage.cacheWriteTokens ?? 0), output: sum.output + r.turn.usage.outputTokens }), { input: 0, output: 0 })
const prefixUsage = sumUsage(prefixRows), sharedLearning = report.summary.B3.metrics.learningUsage
audit.reconciledUsage = {
  input: Object.values(audit.rows).reduce((n, r) => n + r.uncachedInput + r.cachedInput + r.cacheWrite, 0) - 3 * prefixUsage.input - sharedLearning.totalInputTokens,
  output: Object.values(audit.rows).reduce((n, r) => n + r.output, 0) - 3 * prefixUsage.output - sharedLearning.outputTokens }
audit.usageReconciles = audit.reconciledUsage.input === audit.rawUsage.prompt && audit.reconciledUsage.output === audit.rawUsage.completion
const router = new Router(join(output, 'B4')), state = await router.store.read(), executor = new DockerExecutor()
const stage = await mkdtemp(join(output, 'diagnostic-'))
await writeFile(join(stage, 'analysis-start.json'), JSON.stringify(audit, null, 2))
for (const [hash, row] of Object.entries(state.candidates)) {
  const result = { hash, candidate: row.candidate, admitted: row.proof?.passed, bindings: [], forcedExecutions: [] }
  for (const t of report.stream.slice(0, 5)) result.bindings.push({ index: t.index, args: await bind(row.candidate, t.query, router.store.root), captures: row.candidate.templates.map(template => ({ template, capture: parseTemplate(template, t.query) })).filter(x => x.capture) })
  for (const [i, files] of fixtureFiles.entries()) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'router-fault-diagnostic-')))
    try {
      for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content) }
      for (const extension of ['c', 'php', 'java']) {
        const actual = await executor.execute(row.candidate, [extension], root, state.config)
        const oracle = expected({ oracle: 'lines', extension }, files)
        result.forcedExecutions.push({ fixture: i, extension, actual, oracle, correct: actual.exitCode === 0 && actual.stderr === '' && actual.stdout === oracle })
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  audit.diagnostics.push(result)
}
await writeFile(join(stage, 'analysis.json'), JSON.stringify(audit, null, 2))
console.log(JSON.stringify({ path: join(stage, 'analysis.json'), rows: audit.rows, comparisons: audit.comparisons, usageReconciles: audit.usageReconciles,
  physicalRequests: audit.physicalRequests, totalDevelopmentRequests: audit.totalDevelopmentRequests, missingUsage: audit.missingUsageRequestIds,
  diagnostics: audit.diagnostics.map(r => ({ hash: r.hash, matched: r.bindings.filter(x => x.args).map(x => x.index), forcedCorrect: r.forcedExecutions.filter(x => x.correct).length, forcedTotal: r.forcedExecutions.length })) }))
if (!audit.usageReconciles || audit.missingUsageRequestIds.length || audit.totalDevelopmentRequests > audit.modelCallBudget) process.exitCode = 1
