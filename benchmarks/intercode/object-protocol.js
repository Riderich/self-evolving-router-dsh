// Development protocol for the Python rule-object backend. No paid calls here.
import { selected, fixtureFiles, expected } from './protocol.js'
export const runtimeImage = 'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285'
export const originalIndices = [20, 22, 28, 40, 56]
export const boundaries = ['Count nonempty lines in all php files in /testbed recursively', 'Count lines in top-level php files only in /testbed', 'Delete all php files in /testbed', 'Count lines in /etc/passwd']
export function objectStream(data) {
  return originalIndices.map(index => ({ ...selected.find(t => t.index === index), query: data[index].query, split: 'reused-original-development' }))
}
export function objectSuite(rows) {
  return { version: 1, cases: [
    ...fixtureFiles.flatMap((files, i) => rows.map(t => ({ id: `fixture-${i}-${t.index}`, request: t.query, rule_id: 'recursive-lines', args: { extension: t.extension }, files, text: expected(t, files) }))),
    ...boundaries.map((request, i) => ({ id: `boundary-${i}`, request, rule_id: null, files: {} })),
  ] }
}
export function controlPackage(rows, sourceIds, parent = null) {
  const forms = [...new Set(rows.map(t => t.query.replace(t.extension, '{extension}')))]
  const empty = { type: 'object', properties: {}, required: [], additionalProperties: false }
  const manifest = { backend: 'executable-rule-v1', rule_id: 'recursive-lines', description: 'Handwritten extension template and newline-byte counter; no model synthesis', trigger: 'trigger.py', executor: 'executor.py',
    args_schema: { ...empty, properties: { extension: { type: 'string', maxLength: 4, enum: ['c', 'php', 'java'] } }, required: ['extension'] },
    result_schema: { ...empty, properties: { text: { type: 'string', maxLength: 65536 } }, required: ['text'] }, capabilities: ['public-workspace-read'], source_ids: sourceIds, parent_revision: parent }
  return { 'manifest.json': JSON.stringify(manifest, null, 2), 'README.md': 'Manual parameter-template control. Match exact observed wording with one extension slot. Count newline bytes recursively in the public snapshot. Abstain on other requests.\n',
    'trigger.py': `FORMS = ${JSON.stringify(forms)}\ndef trigger(request, context):\n    for form in FORMS:\n        for ext in ('c', 'php', 'java'):\n            if request == form.replace('{extension}', ext):\n                return {'decision':'match','args':{'extension':ext},'reason_code':'template'}\n    return {'decision':'no_match','reason_code':'unmatched'}\n`,
    'executor.py': `import os\ndef execute(request, args, context):\n    total = 0\n    try:\n        for base, dirs, names in os.walk(context['root']):\n            for name in names:\n                if name.endswith('.' + args['extension']):\n                    with open(os.path.join(base, name), 'rb') as f:\n                        while True:\n                            block = f.read(65536)\n                            if not block: break\n                            total += block.count(b'\\n')\n        return {'status':'completed','result':{'text':str(total)+'\\n'}}\n    except OSError:\n        return {'status':'fallback','reason_code':'read_error'}\n` }
}
