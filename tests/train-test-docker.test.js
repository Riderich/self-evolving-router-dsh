import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,mkdtemp,writeFile,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { shared,config } from './rule-helpers.js'
import { RuleStore } from '../lib/rule-store.js'
import { RuleRegistry } from '../lib/rule-registry.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { observeVerified } from '../lib/maintenance-state.js'
import { installStarter } from '../lib/starter-router.js'
import { fixtureFiles,expected,selected } from '../benchmarks/intercode/protocol.js'
import { templatePackage } from '../benchmarks/intercode/train-test-controls.js'
import { freezeRouter,assertFrozen } from '../benchmarks/intercode/train-test-protocol.js'
import { data } from './protocol-fixtures.js'
test('training templates retain seed behavior, add a family and generalize parameters under a frozen registry',{skip:process.env.ROUTER_DOCKER_TEST!=='1'},async t=>{
 await mkdir(shared,{recursive:true});const root=await mkdtemp(join(shared,'train-test-')),stage=await mkdtemp(join(shared,'train-template-'))
 t.after(()=>rm(root,{recursive:true,force:true}));t.after(()=>rm(stage,{recursive:true,force:true}))
 const store=new RuleStore(root);await installStarter(store,{...config,pids:64})
 const rows=[20,22,33].map(index=>({...selected.find(t=>t.index===index),query:data[index].query})),files=fixtureFiles[0]
 for(const row of rows)await observeVerified(store,{id:'train-'+row.index,family:row.family,request:row.query,output:expected(row,files),oracle_id:'test-reference',verified:true,fixture:{files,args:row.oracle==='lines'?{extension:row.extension}:{}}})
 for(const family of ['recursive-lines','file-count']){
  const same=rows.filter(t=>t.family===family),s=await store.read(),ids=same.map(t=>'train-'+t.index),dir=join(stage,family);await mkdir(dir)
  const pkg=await templatePackage(family,same,ids,s.active[family]?.revision??null)
  for(const[n,text]of Object.entries(pkg))await writeFile(join(dir,n),text)
  const registry=new RuleRegistry(store,{historyIds:ids}),submitted=await registry.submit(dir),proof=await registry.validate(submitted.revision)
  assert(proof.passed,JSON.stringify(proof.results.filter(r=>!r.passed)));await registry.activate(proof.validation_id,proof.generation)
 }
 await writeFile(join(root,'new.java'),'one\ntwo');const frozen=await freezeRouter(store)
 for(const[q,text]of [['list visible files','new.java\n'],['count lines in all java files in /testbed recursively','1\n'],[rows[0].query.replace('*.c','*.java'),'1\n'],[rows[2].query,'1\n']])assert.equal((await new ObjectRouter(root).route(q)).text,text)
 assert.equal((await new ObjectRouter(root).route(rows[0].query+' excluding new.java')).kind,'fallback')
 await assertFrozen(new RuleStore(root),frozen)
})
