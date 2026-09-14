import { freezeRouter, assertFrozen } from '../benchmarks/intercode/train-test-protocol.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shared, config } from './rule-helpers.js'
import { RuleStore } from '../lib/rule-store.js'
import { installStarter } from '../lib/starter-router.js'
import { observeVerified } from '../lib/maintenance-state.js'
import { MaintenanceController } from '../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../lib/maintenance-runner.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { processOutput } from '../lib/rule-worker.js'

test('full DSH uses working seed as few-shot, edits only trigger, retains old routes and serves new wording without network',{skip:process.env.ROUTER_PROFILE_TEST!=='1'},async t=>{
 await mkdir(shared,{recursive:true})
 const root=await mkdtemp(join(shared,'starter-profile-')),control=await mkdtemp(join(shared,'starter-control-'))
 t.after(()=>rm(root,{recursive:true,force:true}));t.after(()=>rm(control,{recursive:true,force:true}))
 const store=new RuleStore(root);await installStarter(store,{...config,pids:64})
 await writeFile(join(root,'ok.txt'),'fixture')
 const initial=await store.read(),base=initial.active['list-files'].revision
 assert.equal((await new ObjectRouter(root).route('list visible files')).text,'ok.txt\n')
 assert.equal((await new ObjectRouter(root).route('show visible files')).kind,'fallback')
 for(let i=0;i<3;i++)await observeVerified(store,{id:`verified-${i}`,family:'list-files',request:i===1?'display visible files':'show visible files',output:'ok.txt\n',oracle_id:'host-fixture-directory',verified:true,fixture:{files:{'ok.txt':'fixture'},args:{}}})
 const auth=join(control,'auth.json'),calls=join(control,'calls.jsonl'),loader=join(control,'loader.mjs')
 await writeFile(auth,JSON.stringify({apiKey:'offline-only',baseURL:'https://starter-test.invalid/v1'}),{mode:0o600});await writeFile(calls,'')
 await writeFile(loader,`process.env.STARTER_TEST_CALLS=${JSON.stringify(calls)};await import(${JSON.stringify(new URL('./mock-starter-provider.js',import.meta.url).href)});`)
 const ctrl=new MaintenanceController(store,dshMaintenanceRunner(store,{authFile:auth,loader})),chain=await ctrl.next(),result=await ctrl.run(chain.id)
 const state=await store.read();assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(state.proofs[result.latest_proof]?.results.length,21,JSON.stringify(result));const pkg=state.packages[state.active['list-files'].revision]
 assert.equal(JSON.parse(pkg.files['manifest.json']).parent_revision,base)
 assert.equal(pkg.files['executor.py'],initial.packages[base].files['executor.py'])
 for(const id of ['count-files','recursive-lines'])assert.equal(state.active[id].revision,initial.active[id].revision)
 const rows=(await readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,6)
 for(const request of ['list visible files','show visible files','display visible files'])assert.equal((await new ObjectRouter(root).route(request)).text,'ok.txt\n')
 for(const request of ['show visible files in dir1','show visible files excluding ok.txt','count lines in all php files in /testbed/dir1 recursively'])assert.equal((await new ObjectRouter(root).route(request)).kind,'fallback')
 const deny=join(control,'deny.mjs'),attempts=join(control,'network-attempts');await writeFile(attempts,'')
 await writeFile(deny,`import{appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(attempts)},'attempt\\n');throw Error('NO_NETWORK')}`)
 const frozen=await freezeRouter(store)
 const run=await processOutput(process.execPath,['--import',deny,fileURLToPath(new URL('../run.js',import.meta.url)),'show visible files'],{cwd:root,timeoutMs:180000})
 await assertFrozen(new RuleStore(root),frozen)
 assert.equal(run.exitCode,0,JSON.stringify(run));assert.equal(run.stdout.trim(),'ok.txt');assert.equal(await readFile(attempts,'utf8'),'')
 if(process.env.ROUTER_STARTER_EVIDENCE){const out=process.env.ROUTER_STARTER_EVIDENCE;await mkdir(out,{recursive:true});await writeFile(join(out,'initial-state.json'),JSON.stringify(initial,null,2));await writeFile(join(out,'state.json'),JSON.stringify(state,null,2));await writeFile(join(out,'provider-requests.jsonl'),await readFile(calls));await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,kind:'offline model fixture; real DSH and Docker; no paid learning result',actualExternalCalls:0,mockCalls:6,parentPreserved:true,executorUnchanged:true,otherRulesUnchanged:true,dsh:run,networkAttempts:0},null,2))}
})
