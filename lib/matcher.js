import { realpath, lstat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { requestVeto } from './schema.js'

export function parseTemplate(template, text) {
  const slots = [...template.matchAll(/\{([a-z][a-z0-9_]*)\}/g)]
  if (!slots.length) return template === text ? {} : null
  const values = {}
  let cursor = 0, end = 0
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i], prefix = template.slice(end, slot.index)
    if (!text.startsWith(prefix, cursor)) return null
    cursor += prefix.length
    end = slot.index + slot[0].length
    const next = slots[i + 1]
    const separator = template.slice(end, next?.index ?? template.length)
    if (!separator && !next) { values[slot[1]] = text.slice(cursor); cursor = text.length }
    else {
      const at = text.indexOf(separator, cursor)
      if (at < 0 || text.indexOf(separator, at + separator.length) >= 0) return null
      values[slot[1]] = text.slice(cursor, at); cursor = at
    }
  }
  const suffix = template.slice(end)
  if (text.slice(cursor) !== suffix) return null
  return values
}
export async function bind(candidate, text, root, diagnostics) {
  const veto = requestVeto(text)
  if (veto) { diagnostics?.push({ reason: 'request-veto', veto }); return null }
  const bindings = []
  for (const template of candidate.templates) {
    const captured = parseTemplate(template, text.trim())
    if (!captured) { diagnostics?.push({ template, reason: 'literal-mismatch' }); continue }
    const args = []
    let valid = true
    for (const p of candidate.parameters) {
      const value = captured[p.name]
      if (!value || value.length > 512 || /[\0\r\n]/.test(value)) { valid = false; break }
      switch (p.type) {
        case 'enum': if (!p.values.includes(value)) valid = false; args.push(value); break
        case 'integer': if (!/^\d{1,9}$/.test(value)) valid = false; args.push(value); break
        case 'extension': if (!/^[a-zA-Z0-9]{1,16}$/.test(value)) valid = false; args.push(value); break
        case 'path': {
          if (/[\\$`;&|<>*?\[\]{}\n]/.test(value) || value.startsWith('~')) { valid = false; break }
          const path = resolve(root, value), rel = relative(root, path)
          if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || /(?:^|\/)\.(?:git|dsh|env|ssh)(?:\/|$|\.)/.test(rel)) { valid = false; break }
          try {
            // Reject symlink components even when they currently point inside.
            let current = root
            for (const part of rel.split(sep).filter(Boolean)) {
              current = resolve(current, part)
              if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink')
            }
            if (await realpath(path) !== path) throw new Error('symlink')
          } catch { valid = false; break }
          args.push(rel ? `/testbed/${rel.split(sep).join('/')}` : '/testbed')
          break
        }
      }
    }
    diagnostics?.push({ template, captured, reason: valid ? 'valid-binding' : 'parameter-rejected',
      parameterContracts: candidate.parameters.map(p => ({ ...p, ...(p.type === 'extension' ? { pattern: '^[a-zA-Z0-9]{1,16}$', explanation: 'Bare suffix only; dot/star/quotes must be template literals, not captured arguments.' } : {}) })) })
    if (valid) bindings.push(args)
  }
  if (!bindings.length || bindings.some(x => JSON.stringify(x) !== JSON.stringify(bindings[0]))) {
    if (bindings.length) diagnostics?.push({ reason: 'ambiguous-bindings' })
    return null
  }
  return bindings[0]
}
