import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const script=fileURLToPath(new URL('../scripts/demo.mjs',import.meta.url))
test('demo fails with actionable guidance when Docker is unavailable',()=>{
  const r=spawnSync(process.execPath,[script],{env:{...process.env,PATH:''},encoding:'utf8',timeout:10000})
  assert.equal(r.status,1)
  assert.match(r.stderr,/Docker is unavailable/)
  assert.match(r.stderr,/ROUTER_DOCKER_CONTEXT=colima npm run demo/)
  assert.doesNotMatch(r.stdout,/Installing|Success/)
})
test('demo help needs no Docker and unknown options fail',()=>{
  let r=spawnSync(process.execPath,[script,'--help'],{env:{...process.env,PATH:''},encoding:'utf8'})
  assert.equal(r.status,0);assert.match(r.stdout,/No DSH profile or API credentials required/)
  r=spawnSync(process.execPath,[script,'--unknown'],{encoding:'utf8'})
  assert.equal(r.status,1);assert.match(r.stderr,/Unknown option/)
})
