import test from 'node:test'
import assert from 'node:assert/strict'
import { objectStream, objectSuite, controlPackage } from '../benchmarks/intercode/object-protocol.js'
import { data } from './protocol-fixtures.js'
import { manifest } from '../lib/rule-contract.js'
import { validateSuite } from '../lib/rule-validation.js'
test('object protocol exposes only prefix forms to learned admission and B2', () => {
  const stream = objectStream(data), prefix = stream.slice(0, 3), suite = objectSuite(prefix)
  assert.equal(stream.length, 5)
  assert.equal(suite.cases.length, 10)
  validateSuite(suite)
  for (const t of stream.slice(3)) assert(!suite.cases.some(c => c.request === t.query))
  const pkg = controlPackage(prefix, ['verified-20','verified-22','verified-28'])
  manifest(JSON.parse(pkg['manifest.json']))
  assert(!pkg['trigger.py'].includes(data[40].query.replace('php', '{extension}')))
  assert(!pkg['trigger.py'].includes(data[56].query.replace('java', '{extension}')))
  assert.equal(suite.cases.find(c => c.id === 'fixture-0-20').text, '2\n')
})
