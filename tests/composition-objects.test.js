import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {ruleFixture,fakeWorker} from './rule-helpers.js'
import {configureMaintenance,observeVerified,createChain} from '../lib/maintenance-state.js'
import {RuleOperations} from '../lib/rule-operations.js'
import {ObjectRouter} from '../lib/rule-router.js'
// Controlled execution isolates registry/composition semantics from Python.
const worker={async run(pkg,phase,payload,...rest){
 if(phase==='trigger'){
  const m=JSON.parse(pkg.files['manifest.json']),mode=pkg.files['README.md'].trim()
  const match=mode==='first'?payload.request==='list visible files':mode==='second'?payload.request==='show visible files':['list visible files','show visible files'].includes(payload.request)
  return{result:match?{decision:'match',args:{},reason_code:'test'}:{decision:'no_match',reason_code:'test'},durationMs:1}
 }
 return fakeWorker.run(pkg,phase,payload,...rest)
}}
test('split and merge preserve original oracle families, require every child and publish atomically',async t=>{
 const f=await ruleFixture(t,{worker});await configureMaintenance(f.store,{enabled:true})
 await observeVerified(f.store,{id:'past',family:'list-files',request:'list visible files',output:'',oracle_id:'synthetic',verified:true})
 const admission=join(f.store.dir,'admission.json'),suite=JSON.parse(await readFile(admission,'utf8'))
 suite.cases.push({...suite.cases[0],id:'alias',request:'show visible files'})
 await writeFile(admission,JSON.stringify(suite))
 const c=await createChain(f.store,{rule_id:'list-files',source_ids:['past'],goal:'Test split and merge'})
 const ops=new RuleOperations(f.store,c.id,{worker});await ops.call('create_rule');await ops.call('submit_rule');let proof=await ops.call('validate_rule');assert.equal(proof.passed,true);await ops.call('activate_rule')
 const group=await ops.call('split_rule',{child_ids:['list-first','list-second']})
 for(let i=0;i<2;i++){
  const draftId=group.drafts[i];await writeFile(join(f.store.dir,'drafts',draftId,'README.md'),i===0?'first':'second');await ops.call('submit_rule',{draft_id:draftId})
 }
 proof=await ops.call('validate_rule');assert.equal(proof.passed,true,JSON.stringify(proof));await ops.call('activate_rule')
 assert.deepEqual(Object.keys((await f.store.read()).active).sort(),['list-first','list-second'])
 const router=new ObjectRouter(f.root,{worker});assert.equal((await router.route('show visible files')).program,'list-second')
 await f.store.transaction(s=>{s.maintenance.chains[c.id].status='complete'})
 const mergedChain=await createChain(f.store,{rule_id:'list-first',source_ids:['past'],base_revision:(await f.store.read()).active['list-first'].revision,goal:'Merge children'})
 const merge=new RuleOperations(f.store,mergedChain.id,{worker});const group2=await merge.call('merge_rules',{rule_ids:['list-first','list-second'],new_rule_id:'list-merged'})
 await writeFile(join(f.store.dir,'drafts',group2.drafts[0],'README.md'),'all')
 await merge.call('submit_rule');proof=await merge.call('validate_rule');assert.equal(proof.passed,true,JSON.stringify(proof));await merge.call('activate_rule')
 assert.deepEqual(Object.keys((await f.store.read()).active),['list-merged'])
 assert.equal((await router.route('list visible files')).program,'list-merged')
 assert.equal((await router.route('show visible files')).program,'list-merged')
 assert.equal((await router.route('list hidden files')).kind,'fallback')
})

test('repair retains its non-regressing version when a changed draft loses a passing case',async t=>{
 const selective={async run(pkg,phase,payload,...rest){
  const mode=pkg.files['README.md'].trim()
  if(phase==='trigger')return{result:(mode==='broad'?payload.request.startsWith('list'):payload.request==='list visible files')?{decision:'match',args:{},reason_code:'test'}:{decision:'no_match',reason_code:'test'},durationMs:1}
  const r=await fakeWorker.run(pkg,phase,payload,...rest)
  if(mode==='regressed' && r.result.result.text)r.result.result.text='wrong'
  return r
 }}
 const f=await ruleFixture(t,{worker:selective});await observeVerified(f.store,{id:'past',family:'list-files',request:'list visible files',output:'',oracle_id:'synthetic',verified:true})
 const c=await createChain(f.store,{rule_id:'list-files',source_ids:['past'],goal:'Repair regression test'}),ops=new RuleOperations(f.store,c.id,{worker:selective})
 const draft=await ops.call('create_rule'),file=join(f.store.dir,'drafts',draft.draft_id,'README.md')
 await writeFile(file,'broad');const first=await ops.call('submit_rule');assert.equal((await ops.call('validate_rule')).passed,false)
 await writeFile(file,'regressed');await ops.call('submit_rule');assert.equal((await ops.call('validate_rule')).passed,false)
 let chain=(await f.store.read()).maintenance.chains[c.id]
 assert.equal(chain.stable_revision,first.revision);assert.ok(chain.feedback.at(-1).regressed.includes('visible-one'))
 await writeFile(file,'correct');const fixed=await ops.call('submit_rule');assert.equal((await ops.call('validate_rule')).passed,true)
 chain=(await f.store.read()).maintenance.chains[c.id];assert.equal(chain.stable_revision,fixed.revision)
})
