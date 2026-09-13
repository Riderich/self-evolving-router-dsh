import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ruleFixture, shared, fakeWorker } from './rule-helpers.js'
import { observeVerified, configureMaintenance, createChain, maintenanceState, reserveCall } from '../lib/maintenance-state.js'
import { MaintenanceController } from '../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../lib/maintenance-runner.js'
import { RuleOperations } from '../lib/rule-operations.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { RuleStore } from '../lib/rule-store.js'
async function histories(store){for(let i=0;i<3;i++)await observeVerified(store,{id:`history-${i}`,family:'list-files',request:'list visible files',output:`f${i}.txt\n`,oracle_id:`trusted-fixture-${i}`,verified:true});return ['history-0','history-1','history-2']}
test('maintenance budgets and restart refuse uncertain calls instead of replay',async t=>{
 const f=await ruleFixture(t,{worker:fakeWorker});await configureMaintenance(f.store,{enabled:true,maxCalls:1});await histories(f.store)
 const ctrl=new MaintenanceController(f.store,async c=>{await reserveCall(f.store,c.id,{model:'controlled'});throw Error('disconnected')})
 const chain=await ctrl.next(),result=await ctrl.run(chain.id)
 assert.equal(result.status,'ambiguous');await assert.rejects(ctrl.run(chain.id),/not resumable/)
 const restarted=new MaintenanceController(new RuleStore(f.root),()=>{});assert.equal((await restarted.recover(chain.id)).status,'ambiguous')
 assert.equal(Object.keys(maintenanceState(await f.store.read()).calls).length,1)
})
test('generation captured before target construction cannot bless a stale collection',async t=>{
 const f=await ruleFixture(t,{worker:fakeWorker}),read=f.store.read.bind(f.store);let n=0
 f.store.read=async()=>{if(++n===2)await new RuleStore(f.root).transaction(s=>{s.generation++});return read()}
 await assert.rejects(f.registry.validate(f.submitted.revision),/Stale registry generation/)
})
test('real DSH maintenance edits isolated files, learns from failed validation and activates repaired version', {skip:process.env.ROUTER_PROFILE_TEST!=='1'},async t=>{
 const f=await ruleFixture(t);await configureMaintenance(f.store,{enabled:true,maxCalls:20});await histories(f.store)
 const control=await mkdtemp(join(shared,'evolve-control-'));t.after(()=>rm(control,{recursive:true,force:true}))
 const auth=join(control,'auth.json'),calls=join(control,'calls.jsonl'),loader=join(control,'loader.mjs')
 await writeFile(auth,JSON.stringify({apiKey:'offline-only',baseURL:'https://offline.invalid/v1'}),{mode:0o600});await writeFile(calls,'')
 await writeFile(loader,`process.env.OBJECT_TEST_CALLS=${JSON.stringify(calls)};await import(${JSON.stringify(new URL('./mock-object-provider.js',import.meta.url).href)});`)
 const controller=new MaintenanceController(f.store,dshMaintenanceRunner(f.store,{authFile:auth,loader}))
 const chain=await controller.next(),result=await controller.run(chain.id)
 const s=await f.store.read();assert.equal(result.status,'complete',JSON.stringify({result,events:s.events.slice(-8)}))
 assert.equal(result.feedback[0].passed<4,true);assert.equal(result.feedback.at(-1).passed,4)
 assert.notEqual(result.feedback[0].revision,result.promoted_revision)
 assert.equal(Object.values(maintenanceState(s).calls).length,12)
 assert.ok(s.events.some(e=>e.type==='maintenance-code-diff'))
 const dispatched=(await readFile(calls,'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(dispatched.length,12)
 assert.ok(dispatched.every(c=>c.tools.map(t=>t.function.name).sort().join(',')==='rule,rule_skill,str_replace_editor'),'Only isolated maintenance tools exposed')
 assert.ok(Object.values(s.maintenance.calls).every(c=>c.status==='done' && c.usage),'Every dispatch has settled usage')
 if(process.env.ROUTER_EVIDENCE_DIR){await mkdir(process.env.ROUTER_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.ROUTER_EVIDENCE_DIR,'offline-maintenance-state.json'),JSON.stringify(s,null,2));await writeFile(join(process.env.ROUTER_EVIDENCE_DIR,'offline-provider-calls.jsonl'),await readFile(calls))}
 await writeFile(join(f.root,'new.txt'),'new')
 const router=new ObjectRouter(f.root);assert.equal((await router.route('list visible files')).text,'new.txt\n');assert.equal((await router.route('list hidden files')).kind,'fallback')
 const ops=new RuleOperations(f.store,chain.id)
 await assert.rejects(ops.edit({command:'view',path:'/etc/passwd'},'forbidden'),/path/)
 await assert.rejects(ops.edit({command:'create',path:'/draft/manifest.json',file_text:'{}'},'wrong-scope'),/scope/)
})

test('native DSH cannot dispatch beyond the durable global call budget',{skip:process.env.ROUTER_PROFILE_TEST!=='1'},async t=>{
 const f=await ruleFixture(t);await configureMaintenance(f.store,{enabled:true,maxCalls:2,timeoutMs:120000});await histories(f.store)
 const control=await mkdtemp(join(shared,'budget-control-'));t.after(()=>rm(control,{recursive:true,force:true}))
 const auth=join(control,'auth.json'),calls=join(control,'calls.jsonl'),loader=join(control,'loader.mjs')
 await writeFile(auth,JSON.stringify({apiKey:'offline-only',baseURL:'https://offline.invalid/v1'}),{mode:0o600});await writeFile(calls,'')
 await writeFile(loader,`process.env.OBJECT_TEST_CALLS=${JSON.stringify(calls)};await import(${JSON.stringify(new URL('./mock-object-provider.js',import.meta.url).href)});`)
 const ctrl=new MaintenanceController(f.store,dshMaintenanceRunner(f.store,{authFile:auth,loader})),chain=await ctrl.next()
 const result=await ctrl.run(chain.id);assert.equal(result.status,'stopped',JSON.stringify(result))
 assert.equal((await readFile(calls,'utf8')).trim().split('\n').length,2)
 const state=await f.store.read();assert.equal(Object.keys(state.maintenance.calls).length,2);assert.deepEqual(state.active,{})
})
