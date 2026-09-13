import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { assert, object } from './schema.js'
export const BACKEND = 'executable-rule-v1'
export const RULE_POLICY = 'objects-readonly-v1'
// Bind evidence to the executing trusted implementation, not just a hand-edited
// policy label. Files are read as bytes; none of the package code is imported.
export const KERNEL_HASH = createHash('sha256').update([
  './rule-contract.js', './rule-package.js', './rule-worker.js', './rule-store.js',
  './rule-router.js', './rule-validation.js', './rule-registry.js', './store.js',
  './schema.js', './executor.js', './runtime.js', './dsh-adapter.js', '../index.js',
  './maintenance-state.js', './maintenance-controller.js', './maintenance-plugin.js',
  './maintenance-runner.js', './rule-operations.js', './draft-editor.js', './dsh-runtime.js', '../run.js',
  ...readdirSync(new URL('../maintenance-skills/', import.meta.url)).filter(p => p.endsWith('.md')).sort().map(p => '../maintenance-skills/' + p),
].map(p => p + '\n' + readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n')).digest('hex')
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function canonical(x) { return Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x }
export const id = x => typeof x === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(x)
export const revision = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
export function keys(value, allowed, label) {
  assert(object(value) && Object.keys(value).every(k => allowed.includes(k)), `Invalid ${label} fields`)
}
// Deliberately bounded JSON Schema subset: unsupported keywords fail closed.
// No generated regex or schema code is executed in the trusted process.
export function schema(s, depth = 0) {
  assert(depth <= 8, 'Schema too deep')
  keys(s, ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'maxLength', 'maxItems'], 'schema')
  assert(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(s.type), 'Unsupported schema type')
  if (s.type === 'object') {
    assert(object(s.properties) && Object.keys(s.properties).length <= 32 && s.additionalProperties === false, 'Object schema must bound properties')
    for (const [k, v] of Object.entries(s.properties)) { assert(!['__proto__', 'constructor', 'prototype'].includes(k), 'Unsafe property'); schema(v, depth + 1) }
    assert(Array.isArray(s.required) && new Set(s.required).size === s.required.length && s.required.every(k => Object.hasOwn(s.properties, k)), 'Invalid required fields')
  }
  if (s.type === 'array') { assert(Number.isSafeInteger(s.maxItems) && s.maxItems >= 0 && s.maxItems <= 256, 'Array must be bounded'); schema(s.items, depth + 1) }
  if (s.type === 'string') assert(Number.isSafeInteger(s.maxLength) && s.maxLength >= 0 && s.maxLength <= 65536, 'String must be bounded')
  for (const k of ['minimum', 'maximum']) if (k in s) assert(Number.isFinite(s[k]), 'Invalid numeric bound')
  if ('enum' in s) assert(Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 64, 'Invalid enum')
  return s
}
export function valueMatches(v, s) {
  const valid = s.type === 'object' ? object(v) && Object.keys(v).every(k => Object.hasOwn(s.properties, k)) && s.required.every(k => Object.hasOwn(v, k)) && Object.entries(v).every(([k, x]) => valueMatches(x, s.properties[k]))
    : s.type === 'array' ? Array.isArray(v) && v.length <= s.maxItems && v.every(x => valueMatches(x, s.items))
    : s.type === 'string' ? typeof v === 'string' && v.length <= s.maxLength && !v.includes('\0')
    : s.type === 'integer' ? Number.isSafeInteger(v)
    : s.type === 'number' ? Number.isFinite(v)
    : s.type === 'null' ? v === null : typeof v === 'boolean'
  return valid && (!s.enum || s.enum.some(x => hash(x) === hash(v))) && (s.minimum === undefined || v >= s.minimum) && (s.maximum === undefined || v <= s.maximum)
}
export function manifest(m) {
  keys(m, ['backend', 'rule_id', 'description', 'trigger', 'executor', 'args_schema', 'result_schema', 'capabilities', 'source_ids', 'parent_revision'], 'manifest')
  assert(m.backend === BACKEND && id(m.rule_id), 'Invalid rule identity/backend')
  assert(typeof m.description === 'string' && m.description.length > 0 && m.description.length <= 1000, 'Invalid description')
  assert(m.trigger === 'trigger.py' && m.executor === 'executor.py', 'v1 requires trigger.py/executor.py')
  assert(JSON.stringify(m.capabilities) === '["public-workspace-read"]', 'Unsupported capability')
  assert(m.parent_revision === null || revision(m.parent_revision), 'Invalid parent revision')
  assert(Array.isArray(m.source_ids) && m.source_ids.length > 0 && m.source_ids.length <= 100 && new Set(m.source_ids).size === m.source_ids.length && m.source_ids.every(x => typeof x === 'string' && x.length > 0 && x.length <= 200), 'Invalid source IDs')
  schema(m.args_schema); schema(m.result_schema)
  assert(m.args_schema.type === 'object' && m.result_schema.type === 'object', 'Top-level schemas must be objects')
  return m
}
export function triggerResult(r, m) {
  keys(r, ['decision', 'args', 'reason_code'], 'trigger result')
  assert(['match', 'no_match', 'abstain'].includes(r.decision), 'Invalid trigger decision')
  reason(r.reason_code)
  assert(r.decision === 'match' ? valueMatches(r.args, m.args_schema) : !Object.hasOwn(r, 'args'), 'Invalid trigger arguments')
  return r
}
function reason(x) { assert(typeof x === 'string' && /^[a-z][a-z0-9_-]{0,99}$/.test(x), 'Invalid reason code') }
export function executionResult(r, m) {
  if (r?.status === 'fallback') { keys(r, ['status', 'reason_code'], 'execution fallback'); reason(r.reason_code) }
  else {
    keys(r, ['status', 'result'], 'execution result')
    assert(r.status === 'completed' && valueMatches(r.result, m.result_schema) && typeof r.result.text === 'string', 'Invalid execution result')
  }
  return r
}
export const ruleDefaults = Object.freeze({
  backend: BACKEND, enabled: false, image: '', pythonVersion: '', dockerCommand: 'docker', dockerContext: 'colima',
  snapshotDirectory: '/tmp', triggerTimeoutMs: 2000, executionTimeoutMs: 10000, routeTimeoutMs: 30000,
  maxOutputBytes: 65536, memoryMb: 128, cpus: 1, pids: 32, maxRules: 16,
})
export function ruleConfig(raw = {}) {
  keys(raw, Object.keys(ruleDefaults), 'rule config')
  const c = { ...ruleDefaults, ...raw }
  assert(c.backend === BACKEND && typeof c.enabled === 'boolean', 'Invalid backend/enabled')
  assert(!c.image || /^(sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(c.image), 'Immutable image required')
  assert(!c.pythonVersion || /^3\.\d+\.\d+$/.test(c.pythonVersion), 'Exact Python version required')
  for (const k of ['dockerCommand', 'dockerContext', 'snapshotDirectory']) assert(typeof c[k] === 'string' && !/[\0\r\n,]/.test(c[k]), `Invalid ${k}`)
  assert(c.dockerCommand && c.snapshotDirectory.startsWith('/'), 'Invalid runtime paths')
  for (const [k, lo, hi] of [['triggerTimeoutMs', 100, 10000], ['executionTimeoutMs', 100, 60000], ['routeTimeoutMs', 100, 120000], ['maxOutputBytes', 128, 1048576], ['memoryMb', 32, 512], ['pids', 8, 64], ['maxRules', 1, 64]]) assert(Number.isSafeInteger(c[k]) && c[k] >= lo && c[k] <= hi, `Invalid ${k}`)
  assert(Number.isFinite(c.cpus) && c.cpus > 0 && c.cpus <= 2, 'Invalid CPU limit')
  if (c.enabled) assert(c.image && c.pythonVersion, 'Pin image and Python before enabling')
  return c
}
export function environmentKey(c) { const { enabled, ...environment } = c; return hash({ environment, policy: RULE_POLICY, kernel: KERNEL_HASH }) }
