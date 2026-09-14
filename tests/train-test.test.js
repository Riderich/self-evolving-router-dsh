import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp,realpath,writeFile,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { starterImage } from '../lib/starter-router.js'
import { RuleStore } from '../lib/rule-store.js'
import { hash } from '../lib/rule-contract.js'
import { observeVerified,configureMaintenance } from '../lib/maintenance-state.js'
import { sourceCommit } from '../benchmarks/intercode/protocol.js'
import { splitTasks,conditions,runTrainTest,trainingGoal,freezeRouter,assertFrozen } from '../benchmarks/intercode/train-test-protocol.js'
import { data } from './protocol-fixtures.js'
const raw=Buffer.from(JSON.stringify(data)),spec={version:1,sourceCommit,datasetSha256:createHash('sha256').update(raw).digest('hex'),exposure:'reused-development',train:[20,22,33],test:[28,40,56,0,17,53],maxHTTPCalls:160,maintenanceMaxCalls:24,attemptsPerStage:2}
test('curriculum binds dataset, disjoint IDs, exact wording, order, and test generalization labels',()=>{
 const plan=splitTasks(raw,spec)
 assert.deepEqual(plan.train.map(t=>t.index),[20,22,33]);assert.deepEqual(plan.test.map(t=>t.category),['new-wording','new-wording','new-parameter','unseen-family','unseen-family','unseen-family'])
 for(const patch of [{test:[20]},{train:[22,20]},{train:[]},{test:[8]},{exposure:'sealed'},{datasetSha256:'0'.repeat(64)},{maxHTTPCalls:0},{maxHTTPCalls:161},{attemptsPerStage:99}])assert.throws(()=>splitTasks(raw,{...spec,...patch}))
 const copied=structuredClone(data);copied[28].query='  '+copied[20].query.toUpperCase()+'  '
 const duplicate=Buffer.from(JSON.stringify(copied));assert.throws(()=>splitTasks(duplicate,{...spec,datasetSha256:createHash('sha256').update(duplicate).digest('hex')}),/Duplicate request/)
 const goal=trainingGoal(1,3,'recursive-lines');assert.match(goal,/persists across training tasks/);assert.match(goal,/test-time rule edits are forbidden/);assert(!goal.includes(data[40].query))
})
function adapters(tamper=false,throwTask=false){
 const out={}
 for(const c of conditions){
  const state={histories:[],version:0},calls=[],learned=[]
  out[c]={state,calls,learned,
   async task(task,phase){calls.push([phase,task.index]);if(phase==='test'&&c==='B4'){if(tamper)state.histories.push(task.index);if(throwTask)throw Error('task failed')}return{correct:task.index!==20}},
   async observe(task,result){state.histories.push(task.index);assert(!spec.test.includes(task.index));if(task.index===20)assert.equal(result.correct,false)},
   async learn(stage){learned.push({stage,history:[...state.histories],base:state.version});state.version++},
   async checkpoint(){},async freeze(){return{digest:hash(state)}},async assertFrozen(f){assert.equal(hash(state),f.digest,'Frozen test router changed')}
  }
 }
 return out
}
test('training accumulates verified reference feedback per task; every test condition is frozen',async()=>{
 const plan=splitTasks(raw,spec),a=adapters(),records=[];await runTrainTest(plan,a,async row=>records.push(row))
 assert.deepEqual(a.B4.learned.map(x=>x.history),[[20],[20,22],[20,22,33]])
 assert.deepEqual(a.B4.learned.map(x=>x.base),[0,1,2]);assert.equal(a.B3.learned.length,1);assert.deepEqual(a.B3.learned[0].history,[20,22,33])
 for(const c of ['B0','B1']){assert.equal(a[c].learned.length,0);assert.deepEqual(a[c].state.histories,[])}
 for(const c of ['B2','B3','B4'])assert.deepEqual(a[c].state.histories,[20,22,33])
 assert.equal(records.filter(r=>r.phase==='test').length,30)
 const firstTest=records.findIndex(r=>r.phase==='test');assert.equal(records.slice(0,firstTest).filter(r=>r.phase==='freeze').length,5)
})
test('test-time mutation or task failure invalidates evaluation instead of learning or retrying',async()=>{
 await assert.rejects(runTrainTest(splitTasks(raw,spec),adapters(true)),/Frozen test router changed/)
 const a=adapters(false,true);await assert.rejects(runTrainTest(splitTasks(raw,spec),a),/task failed/)
 assert.deepEqual(a.B4.calls.filter(([p])=>p==='test'),[['test',28]])
})
test('durable freeze permits request logs, but detects changes to rules, histories, configuration, drafts and admission',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'train-test-freeze-')));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=new RuleStore(root);await store.configure({enabled:true,image:starterImage,pythonVersion:'3.13.15'});await configureMaintenance(store,{enabled:true})
 await writeFile(join(store.dir,'admission.json'),'fixed admission bytes')
 await observeVerified(store,{id:'train-20',family:'recursive-lines',request:'count lines',output:'1\n',oracle_id:'test-reference',verified:true})
 const frozen=await freezeRouter(store);assert.equal((await store.read()).maintenance.config.enabled,false)
 await store.transaction(s=>s.events.push({type:'object-agent-turn',usage:{inputTokens:2}}));await assertFrozen(new RuleStore(root),frozen)
 const saved=await readFile(join(store.dir,'state.json'),'utf8')
 for(const mutate of [s=>s.packages.fake={},s=>s.active.fake={},s=>s.maintenance.histories.test={},s=>s.maintenance.chains.test={},s=>s.maintenance.config.enabled=true,s=>s.sources.test={},s=>s.events.push({type:'object-activate'})]){
  await store.transaction(mutate);await assert.rejects(assertFrozen(store,frozen),/Frozen test router changed/)
  await writeFile(join(store.dir,'state.json'),saved)
 }
 await writeFile(join(store.dir,'admission.json'),'test answer inserted');await assert.rejects(assertFrozen(store,frozen),/Frozen test router changed/)
})
