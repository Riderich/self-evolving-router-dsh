import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { evolutionStream, evolutionSuite, pastTemplates } from '../benchmarks/intercode/evolution-protocol.js'
import { sourceCommit } from '../benchmarks/intercode/protocol.js'
import { data } from './protocol-fixtures.js'
test('Evolution suite contains no future positive query; input strings unchanged', () => {
  const stream = evolutionStream(data), suite = evolutionSuite(data)
  assert.deepEqual(stream.slice(0, 5).map(t => t.query), [20, 22, 28, 40, 56].map(i => data[i].query))
  assert.ok(suite.cases.filter(c => c.route).every(c => stream.slice(0, 3).some(t => t.query === c.request)))
  for (const t of stream.slice(3)) assert.ok(!suite.cases.some(c => c.request === t.query))
  assert.equal(stream.filter(t => t.split === 'synthetic-reuse-probe').length, 3)
})
test('Template control extracts slots from past rows only', () => {
  const stream = evolutionStream(data), templates = pastTemplates(stream.slice(0, 3))
  assert.equal(templates.length, 3)
  assert.ok(templates.every(t => t.includes('{extension}')))
  assert.ok(!templates.includes(stream[3].query.replace('php', '{extension}')))
  assert.equal(pastTemplates([...stream.slice(0, 4), stream[5]]).length, 4)
})
