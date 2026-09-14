import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ruleFixture, shared, fakeWorker, config } from './rule-helpers.js'
import { installStarter, starterDirectory } from '../lib/starter-router.js'
import { RuleStore } from '../lib/rule-store.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { RuleOperations } from '../lib/rule-operations.js'
import { activeExamples } from '../lib/rule-examples.js'
import { observeVerified, createChain, configureMaintenance } from '../lib/maintenance-state.js'
import { MaintenanceController } from '../lib/maintenance-controller.js'
import { RuleWorker, requestSnapshot } from '../lib/rule-worker.js'
import { readPackage, checkPackage } from '../lib/rule-package.js'
import { hash } from '../lib/rule-contract.js'
import { validateSuite } from '../lib/rule-validation.js'

test('starter admission is a valid contract with scope and unterminated-line cases',async()=>{
 const suite=validateSuite(JSON.parse(await readFile(join(starterDirectory,'admission.json'),'utf8')))
 assert.equal(suite.cases.length,18)
 assert.equal(suite.cases.find(c=>c.id==='recursive-lines-0-c').text,'3\n')
 assert(suite.cases.some(c=>c.rule_id===null&&c.request.includes('/testbed/dir1')))
 assert(suite.cases.some(c=>c.rule_id===null&&c.request.includes('excluding')))
})
test('active rule is the few-shot and default editing base; repeated create preserves edits',async t=>{
 const f=await ruleFixture(t,{worker:fakeWorker}),proof=await f.registry.validate(f.submitted.revision)
 await f.registry.activate(proof.validation_id,proof.generation)
 await observeVerified(f.store,{id:'new-phrase',family:'list-files',request:'show visible files',output:'ok.txt\n',oracle_id:'trusted-fixture',verified:true})
 const c=await createChain(f.store,{rule_id:'list-files',source_ids:['new-phrase'],base_revision:f.submitted.revision,goal:'Support equivalent listing wording'})
 const examples=await activeExamples(f.store,c)
 assert.equal(examples[0].revision,f.submitted.revision)
 assert.equal(examples[0].files['trigger.py'],(await f.store.read()).packages[f.submitted.revision].files['trigger.py'])
 const ops=new RuleOperations(f.store,c.id),d=await ops.call('create_rule')
 assert.equal(d.base_revision,f.submitted.revision)
 const path=join(f.store.dir,'drafts',d.draft_id,'executor.py');await writeFile(path,'# retained edit\n')
 assert.equal((await ops.call('create_rule')).draft_id,d.draft_id)
 assert.equal(await readFile(path,'utf8'),'# retained edit\n')
 await f.store.configure({enabled:false})
 // Disabled configuration never supplies an executable example.
 assert.equal((await activeExamples(f.store,c)).length,0)
})
test('working starter routes three families, abstains on scope modifiers, skips covered maintenance',{skip:process.env.ROUTER_DOCKER_TEST!=='1'},async t=>{
 await mkdir(shared,{recursive:true});const root=await mkdtemp(join(shared,'starter-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=new RuleStore(root),result=await installStarter(store,{...config,pids:64})
 assert.equal(result.validationCases,18)
 await assert.rejects(installStarter(store,config),/fresh object registry/)
 await writeFile(join(root,'a.c'),'one\ntwo');await mkdir(join(root,'nested'));await writeFile(join(root,'nested','b.c'),'more\n')
 const router=new ObjectRouter(root)
 // Fault injection in the real isolated worker: an in-scope read must never
 // become a successful partial count. Snapshot permissions are normalized.
 const pkg=await readPackage(join(starterDirectory,'rules','recursive-lines'))
 const files={...pkg.files,'executor.py':"def open(*args, **kwargs):\n    raise PermissionError('injected read failure')\n"+pkg.files['executor.py']}
 const changed=checkPackage({files,revision:hash(files)}),snap=await requestSnapshot(root,{...config,pids:64})
 try{const failed=await new RuleWorker().run(changed,'executor',{request:'count lines',args:{extension:'c'},context:{root:'/testbed'}},{...config,pids:64},snap);assert.equal(failed.result.status,'fallback');assert.equal(failed.result.reason_code,'read_error')}finally{await snap.dispose()}
 for(const [request,text]of [['list visible files','a.c\n'],['count visible files','1\n'],['count lines in all c files in /testbed recursively','2\n']])assert.equal((await router.route(request)).text,text)
 for(const request of ['count lines in all c files in /testbed/nested recursively','count lines in all c files in /testbed recursively excluding nested'])assert.equal((await router.route(request)).kind,'fallback')
 for(let i=0;i<3;i++)await observeVerified(store,{id:'covered-'+i,family:'list-files',request:'list visible files',output:'a.c\n',oracle_id:'actual-fixture-list',verified:true})
 await configureMaintenance(store,{enabled:true})
 const ctrl=new MaintenanceController(store,()=>{throw Error('No model should run')})
 assert.equal(await ctrl.next(),null)
 assert.equal(Object.keys((await store.read()).maintenance.calls).length,0)
 assert.equal(Object.keys((await store.read()).maintenance.covered).length,3)
 await observeVerified(store,{id:'new-phrase',family:'list-files',request:'show visible files',output:'a.c\n',oracle_id:'actual-fixture-list',verified:true})
 const chain=await ctrl.next();assert.equal(chain.base_revision,(await store.read()).active['list-files'].revision)
 assert.equal((await activeExamples(store,chain))[0].rule_id,'list-files')
})
