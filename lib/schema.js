import { createHash } from 'node:crypto'

export const POLICY = 'prellm-readonly-v1'
export const MAX_TEXT = 4096
export const defaults = Object.freeze({
  version: 1, enabled: false, learning: true, automaticPromotion: true,
  learningMode: 'regenerate',
  minHistory: 3, maxHistory: 200, maxCandidates: 100,
  maxModelCallsPerDay: 12, maxLearningTokensPerDay: 500000,
  maxPromptChars: 24000, maxOutputTokens: 6000, learningTimeoutMs: 120000,
  timeoutMs: 10000, maxOutputBytes: 65536, failureThreshold: 2,
  image: '', dockerContext: '', dockerCommand: 'docker',
  snapshotDirectory: '/tmp',
  maxPrograms: 64, maxValidationCases: 64,
})
export function assert(ok, message) { if (!ok) throw new Error(message) }
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
export function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }
export function bounded(v, max, name) {
  assert(typeof v === 'string' && v.length > 0 && v.length <= max && !/[\0\u202a-\u202e\u2066-\u2069]/u.test(v), `Invalid ${name}`)
  return v
}
export function validateConfig(raw = {}) {
  assert(object(raw), 'Configuration must be an object')
  for (const key of Object.keys(raw)) assert(key in defaults, `Unknown configuration key: ${key}`)
  const c = { ...defaults, ...raw }
  assert(c.version === 1, 'Unsupported configuration version')
  assert(['regenerate', 'feedback-local'].includes(c.learningMode), 'Invalid learningMode')
  for (const k of ['enabled', 'learning', 'automaticPromotion']) assert(typeof c[k] === 'boolean', `${k} must be boolean`)
  for (const [k, lo, hi] of [
    ['minHistory', 2, 100], ['maxHistory', 3, 1000], ['maxCandidates', 1, 1000],
    ['maxModelCallsPerDay', 1, 1000], ['maxLearningTokensPerDay', 1000, 10000000],
    ['maxPromptChars', 1000, 100000], ['maxOutputTokens', 100, 16000],
    ['learningTimeoutMs', 1000, 600000], ['timeoutMs', 100, 60000],
    ['maxOutputBytes', 128, 1048576], ['failureThreshold', 1, 10], ['maxPrograms', 1, 256], ['maxValidationCases', 2, 256],
  ]) assert(Number.isSafeInteger(c[k]) && c[k] >= lo && c[k] <= hi, `Invalid ${k}`)
  assert(c.maxHistory >= c.minHistory, 'maxHistory below minHistory')
  for (const k of ['image', 'dockerContext', 'dockerCommand', 'snapshotDirectory']) assert(typeof c[k] === 'string' && !/[\0\r\n]/.test(c[k]), `Invalid ${k}`)
  assert(c.snapshotDirectory.startsWith('/') && !c.snapshotDirectory.includes(','), 'snapshotDirectory must be an absolute Docker-shared directory')
  assert(!c.image || /^sha256:[a-f0-9]{64}$/.test(c.image) || /@sha256:[a-f0-9]{64}$/.test(c.image), 'Image must be an immutable ID/digest')
  return c
}
export function validateCandidate(raw) {
  assert(object(raw), 'Candidate must be an object')
  const allowed = ['id', 'description', 'parent', 'templates', 'parameters', 'script', 'requires', 'sourceIds']
  for (const k of Object.keys(raw)) assert(allowed.includes(k), `Unknown candidate field: ${k}`)
  assert(/^[a-z][a-z0-9-]{1,63}$/.test(raw.id), 'Invalid program id')
  bounded(raw.description, 1000, 'description')
  assert(raw.parent === null || /^[a-f0-9]{64}$/.test(raw.parent), 'parent must be null or digest')
  assert(Array.isArray(raw.sourceIds) && raw.sourceIds.length >= 2 && raw.sourceIds.length <= 100 && raw.sourceIds.every(x => typeof x === 'string' && x.length < 200), 'Invalid sourceIds')
  assert(new Set(raw.sourceIds).size === raw.sourceIds.length, 'Duplicate sourceIds')
  assert(Array.isArray(raw.parameters) && raw.parameters.length <= 4, 'At most four parameters')
  const names = new Set()
  for (const p of raw.parameters) {
    assert(object(p) && Object.keys(p).every(k => ['name', 'type', 'values'].includes(k)), 'Invalid parameter')
    assert(/^[a-z][a-z0-9_]{0,23}$/.test(p.name) && !names.has(p.name), 'Invalid/duplicate parameter name')
    names.add(p.name)
    assert(['path', 'extension', 'integer', 'enum'].includes(p.type), 'Unsupported parameter type')
    if (p.type === 'enum') assert(Array.isArray(p.values) && p.values.length > 0 && p.values.length <= 32 && p.values.every(x => typeof x === 'string' && /^[\p{L}\p{N}_-]{1,40}$/u.test(x)), 'Invalid enum values')
    else assert(p.values === undefined, 'values only allowed for enum')
  }
  assert(Array.isArray(raw.templates) && raw.templates.length > 0 && raw.templates.length <= 32, 'Invalid templates')
  for (const t of raw.templates) {
    bounded(t, 512, 'template')
    const slots = [...t.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map(m => m[1])
    assert(slots.length === names.size && new Set(slots).size === slots.length && slots.every(s => names.has(s)), 'Every template must bind each parameter exactly once')
    assert(!/\}\s*\{/.test(t), 'Adjacent parameters are ambiguous')
    assert(!/[{}]/.test(t.replace(/\{([a-z][a-z0-9_]*)\}/g, '')), 'Invalid template braces')
    assert(t.replace(/\{[^}]+\}/g, '').trim().length >= 4, 'Template needs a literal intent')
  }
  bounded(raw.script, 16384, 'script')
  assert(raw.script.startsWith('#!/bin/sh\n'), 'Script must use /bin/sh with LF')
  // Defence in depth only. The actual authority boundary is the container.
  assert(!/(?:^|[\s;&|()])(?:sudo|su|curl|wget|ssh|scp|mount|umount|docker|podman|eval|source|rm|mv|chmod|chown)\b/m.test(raw.script), 'Blocked script operation')
  assert(!raw.script.includes('\r'), 'Script must use LF')
  assert(Array.isArray(raw.requires) && raw.requires.length <= 16 && raw.requires.every(x => /^[a-zA-Z0-9_.+-]{1,64}$/.test(x)), 'Invalid required executables')
  return structuredClone(raw)
}
export function sensitive(text) {
  return /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})|(?:api[_-]?key|password|authorization|access[_-]?token)\s*[:=]\s*["']?\S{8,})/i.test(text)
}
export function requestVeto(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT || !text.trim()) return 'invalid-request'
  if (/[\0\r\n\u202a-\u202e\u2066-\u2069]/u.test(text)) return 'multiline-or-control'
  if (sensitive(text)) return 'sensitive-request'
  if (/(?:\b(?:delete|remove|overwrite|upload|download|sudo|password|secret|credentials)\b|删除|覆盖|上传|下载|密码|密钥|凭证)/i.test(text)) return 'unsupported-authority'
  if (/(?:\.\.\/|\.\.\\|~\/|\$\(|`|https?:\/\/)/.test(text)) return 'unsafe-syntax'
  return null
}
