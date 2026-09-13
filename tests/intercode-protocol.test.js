import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { expected, programs, selected, evaluationSuite, score } from '../benchmarks/intercode/protocol.js'
import { validateCandidate } from '../lib/schema.js'
import { parseTemplate } from '../lib/matcher.js'
import { data } from './protocol-fixtures.js'
test('independent oracle counts newline bytes, not logical lines or filenames', () => {
  assert.equal(expected({ oracle: 'lines', extension: 'php' }, { 'a.php': 'a\nb', 'b.php': '', 'nested/c.php': '\n', 'x.txt': '\n' }), '2\n')
  assert.equal(expected({ oracle: 'lines', extension: 'c' }, {}), '0\n')
  assert.equal(expected({ oracle: 'file-count' }, { 'a\nb.txt': 'x' }), '1\n')
})
test('static templates retain input queries and separate nonempty-line requests', () => {
  const candidates = programs(data).map(validateCandidate)
  for (const task of selected) {
    const hits = candidates.filter(c => c.templates.some(template => parseTemplate(template, data[task.index].query)))
    assert.equal(hits.length, task.eligible ? 1 : 0, `index ${task.index}`)
  }
  assert.equal(evaluationSuite(data, candidates).cases.filter(c => !c.route).length, 25)
})
test('oracle distinguishes basename/content duplication and empty stdout', () => {
  assert.equal(expected({ oracle: 'duplicate-md5' }, { 'a.java': 'same', 'nested/b.java': 'same' }), '')
  assert.equal(expected({ oracle: 'duplicate-names' }, { 'a.txt': '', 'nested/A.txt': '' }), 'A.txt\n')
  assert.equal(score({ eligible: true }, { kind: 'completed', stdout: '(no output)', stderr: '', exitCode: 0 }, '').correct, false)
  assert.equal(score({ eligible: false }, { kind: 'fallback' }, null).taskSuccess, null)
  assert.equal(score({ eligible: true }, { kind: 'completed', stdout: '0\n', stderr: 'error', exitCode: 0 }, '0\n').incorrectAutomation, true)
})
