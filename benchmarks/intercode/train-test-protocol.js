// Host-owned curriculum and freeze checks. No test outcome enters maintenance.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selected, sourceCommit } from './protocol.js'
import { hash, KERNEL_HASH } from '../../lib/rule-contract.js'
import { configureMaintenance } from '../../lib/maintenance-state.js'
export const protocol = 'intercode-train-freeze-test-v1'
export const conditions = ['B0','B1','B2','B3','B4']
export function splitTasks(raw, spec) {
  assert(spec.version === 1 && spec.sourceCommit === sourceCommit, 'Unsupported split/source version')
  assert(spec.datasetSha256 === createHash('sha256').update(raw).digest('hex'), 'Dataset differs from declared split')
  assert(spec.exposure === 'reused-development', 'This audited catalog is development data, not sealed')
  for (const key of ['train','test']) assert(Array.isArray(spec[key]) && spec[key].length > 0, 'Both splits must be nonempty')
  const ids = [...spec.train,...spec.test]
  assert(ids.every(Number.isSafeInteger) && new Set(ids).size === ids.length, 'Duplicate/overlapping task IDs')
  assert(spec.train.every((x,i,a)=>i===0||x>a[i-1]), 'Training order must follow the declared dataset order')
  const data = JSON.parse(raw), queries = new Set()
  const tasks = ids.map(index => {
    const task = selected.find(t=>t.index===index)
    assert(task?.eligible && typeof data[index]?.query === 'string', 'Task needs an audited read-only exact oracle')
    const query = data[index].query, normalized = query.trim().toLowerCase().replace(/\s+/g,' ')
    assert(normalized && !queries.has(normalized), 'Duplicate request across curriculum');queries.add(normalized)
    return {...task,query}
  })
  const train = tasks.slice(0,spec.train.length)
  const test = tasks.slice(spec.train.length).map(t=>({...t,category:!train.some(x=>x.family===t.family)?'unseen-family':t.extension&&!train.some(x=>x.extension===t.extension&&x.family===t.family)?'new-parameter':'new-wording'}))
  assert(Number.isSafeInteger(spec.maxHTTPCalls)&&spec.maxHTTPCalls>=1&&spec.maxHTTPCalls<=160, 'Explicit HTTP budget required')
  assert(Number.isSafeInteger(spec.maintenanceMaxCalls)&&spec.maintenanceMaxCalls>=1&&spec.maintenanceMaxCalls<=spec.maxHTTPCalls, 'Invalid cumulative maintenance budget')
  assert(Number.isSafeInteger(spec.attemptsPerStage)&&spec.attemptsPerStage>=1&&spec.attemptsPerStage<=3, 'Invalid per-stage attempt bound')
  return {train,test}
}
export function trainingGoal(position,total,family) {
  return `Training stage ${position}/${total}. This router persists across training tasks: retain validated rules, build on the active stable version, and reuse learned rules as examples. You may incrementally improve the router using ONLY the verified training prefix supplied below. No later training requests, test requests, test answers, or test feedback are available. Extend uncovered requests for family ${family}; pass all existing and historical replay checks before activation. Do not republish unchanged executable code. Training ends with a frozen router; test-time rule edits are forbidden.`
}
export async function learnedState(store) {
  const state=await store.read()
  // Request/usage events may grow during evaluation; all learned artifacts,
  // histories, budgets, pending drafts and operational controls must stay fixed.
  const {events,revision,...persistent}=state
  return {kernelHash:KERNEL_HASH,state:persistent,admission:await readFile(join(store.dir,'admission.json'),'utf8')}
}
export async function freezeRouter(store) {
  await configureMaintenance(store,{enabled:false})
  const snapshot=await learnedState(store)
  const state=await store.read()
  return {digest:hash(snapshot),snapshot,eventCount:state.events.length,eventPrefixHash:hash(state.events)}
}
export async function assertFrozen(store,frozen) {
  assert.equal(hash(await learnedState(store)),frozen.digest,'Frozen test router changed; evaluation invalid')
  const state=await store.read()
  assert.equal(hash(state.events.slice(0,frozen.eventCount)),frozen.eventPrefixHash,'Frozen test router changed: audit history rewritten')
  assert(state.events.slice(frozen.eventCount).every(e=>['object-route','object-agent-turn'].includes(e.type)),'Frozen test router changed: test-time maintenance event')
}
// Adapters keep full DSH execution and accounting outside the phase controller.
// Test tasks are passed to task() only after every condition has been frozen.
export async function runTrainTest(plan,adapters,record=async()=>{}) {
  assert(conditions.every(c=>adapters[c]),'All five controls are required')
  for(const [i,task] of plan.train.entries()) {
    for(const c of conditions) {
      const start=performance.now(),a=adapters[c],result=await a.task(task,'train')
      if(['B2','B3','B4'].includes(c))await a.observe(task,result)
      if(['B2','B4'].includes(c))await a.learn({position:i+1,total:plan.train.length,batch:false})
      await a.checkpoint(`train-${task.index}`)
      await record({phase:'train',condition:c,index:task.index,result,wallMs:performance.now()-start})
    }
  }
  const batchStart=performance.now()
  await adapters.B3.learn({position:plan.train.length,total:plan.train.length,batch:true})
  await record({phase:'train-batch',condition:'B3',wallMs:performance.now()-batchStart})
  const frozen={}
  for(const c of conditions){const start=performance.now();frozen[c]=await adapters[c].freeze();await adapters[c].checkpoint('trained');await record({phase:'freeze',condition:c,digest:frozen[c].digest,wallMs:performance.now()-start})}
  for(const task of plan.test)for(const c of conditions){
    const start=performance.now(),a=adapters[c];await a.assertFrozen(frozen[c])
    let result
    try{result=await a.task(task,'test')}finally{await a.assertFrozen(frozen[c])}
    await record({phase:'test',condition:c,index:task.index,category:task.category,result,wallMs:performance.now()-start})
  }
  for(const c of conditions)await adapters[c].assertFrozen(frozen[c])
  return frozen
}
