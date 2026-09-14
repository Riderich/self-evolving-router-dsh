import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleFixture, fakeWorker } from './rule-helpers.js'
import { observeVerified, createChain } from '../lib/maintenance-state.js'
import { RuleOperations } from '../lib/rule-operations.js'
import { RuleRegistry } from '../lib/rule-registry.js'
async function base(t){const f=await ruleFixture(t,{worker:fakeWorker}),p=await f.registry.validate(f.submitted.revision);await f.registry.activate(p.validation_id,p.generation);return f}
async function record(store,request='show visible files',fixture=true){return observeVerified(store,{id:'history',family:'list-files',request,output:'ok.txt\n',oracle_id:'trusted-directory',verified:true,...(fixture?{fixture:{files:{'ok.txt':'fixture'},args:{}}}:{})})}
test('incremental validation requires replaying uncovered history, not only passing old tests',async t=>{
 const f=await base(t);await record(f.store)
 const chain=await createChain(f.store,{rule_id:'list-files',source_ids:['history'],base_revision:f.submitted.revision,goal:'Extend listing wording'})
 const ops=new RuleOperations(f.store,chain.id,{worker:fakeWorker});await ops.call('create_rule');await ops.call('submit_rule');const proof=await ops.call('validate_rule')
 assert.equal(proof.results.length,5);assert.equal(proof.passed,false)
 const replay=proof.results.find(r=>r.case_id.startsWith('history-'));assert.equal(replay.request,'show visible files');assert.equal(replay.passed,false)
 await assert.rejects(ops.call('activate_rule'),/Candidate rejected/)
 assert.equal((await f.store.read()).active['list-files'].revision,f.submitted.revision)
})
test('metadata-only republishing cannot count as an incremental executable update',async t=>{
 const f=await base(t);await record(f.store,'list visible files',false)
 const chain=await createChain(f.store,{rule_id:'list-files',source_ids:['history'],base_revision:f.submitted.revision,goal:'Maintain listing'})
 const ops=new RuleOperations(f.store,chain.id,{worker:fakeWorker});await ops.call('create_rule');await ops.call('submit_rule');assert.equal((await ops.call('validate_rule')).passed,true)
 await assert.rejects(ops.call('activate_rule'),/No executable change/)
})
test('replay evidence is inherited during revalidation and cannot change after proof',async t=>{
 const f=await base(t);await record(f.store,'list visible files')
 const registry=new RuleRegistry(f.store,{worker:fakeWorker,historyIds:['history']}),proof=await registry.validate(f.submitted.revision)
 assert.equal(proof.passed,true);await registry.activate(proof.validation_id,proof.generation)
 const inherited=await f.registry.validate(f.submitted.revision);assert.equal(inherited.results.length,5);assert.ok(inherited.historyEvidence.history)
 await assert.rejects(observeVerified(f.store,{...(await f.store.read()).maintenance.histories.history,fixture:{files:{'other.txt':'changed'},args:{}}}),/History immutable/)
 await f.store.transaction(s=>{s.maintenance.histories.history.output='tampered\n'})
 await assert.rejects(f.registry.activate(inherited.validation_id,inherited.generation),/Replay evidence changed/)
})
test('trusted replay fixtures still reject out-of-view paths',async t=>{
 const f=await base(t)
 await assert.rejects(observeVerified(f.store,{id:'bad-fixture',family:'list-files',request:'list visible files',output:'x',oracle_id:'test',verified:true,fixture:{args:{},files:{'../private.txt':'x'}}}),/Unsafe fixture path/)
})
