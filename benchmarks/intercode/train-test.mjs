// Explicit paid run: AUTH DATA EXPORTED_FS SPLIT NEW_OUTPUT.
// Read-only/no-model preflight: --inspect DATA EXPORTED_FS SPLIT.
import assert from 'node:assert/strict'
import { readFile,writeFile,mkdir,cp,rm,realpath,lstat,rename } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { RuleStore } from '../../lib/rule-store.js'
import { RuleRegistry } from '../../lib/rule-registry.js'
import { configureMaintenance,observeVerified } from '../../lib/maintenance-state.js'
import { MaintenanceController } from '../../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../../lib/maintenance-runner.js'
import { installStarter,starterImage,starterDirectory } from '../../lib/starter-router.js'
import { validateSuite } from '../../lib/rule-validation.js'
import { processOutput } from '../../lib/rule-worker.js'
import { snapshot } from '../../lib/executor.js'
import { preflight } from '../../lib/rule-preflight.js'
import { hash,KERNEL_HASH } from '../../lib/rule-contract.js'
import { inventory,fingerprint,expected,sourceCommit } from './protocol.js'
import { protocol,conditions,splitTasks,trainingGoal,freezeRouter,assertFrozen,runTrainTest } from './train-test-protocol.js'
import { templatePackage } from './train-test-controls.js'
const inspect=process.argv[2]==='--inspect',args=process.argv.slice(inspect?3:2)
assert.equal(args.length,inspect?3:5,inspect?'--inspect DATA EXPORTED_FS SPLIT':'AUTH DATA EXPORTED_FS SPLIT NEW_OUTPUT (paid)')
const [dataFile,source,specFile]=await Promise.all((inspect?args:args.slice(1,4)).map(p=>realpath(resolve(p))))
const raw=await readFile(dataFile),spec=JSON.parse(await readFile(specFile,'utf8')),plan=splitTasks(raw,spec),view=await inventory(source)
// Exact original public filesystem, not a manufactured success or truncated view.
const files=Object.fromEntries(Object.entries(view.files).map(([p,b])=>{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(b);assert(Buffer.from(text).equals(b),'Replay must preserve bytes');return[p,text]
}))
const baseSuite=JSON.parse(await readFile(join(starterDirectory,'admission.json'),'utf8'))
validateSuite({version:1,cases:[...baseSuite.cases,...plan.train.map(t=>({id:'train-'+t.index,request:t.query,rule_id:t.family,args:t.oracle==='lines'?{extension:t.extension}:{},text:expected(t,files),files}))]})
for(const task of plan.test)expected(task,view.files) // Host-only oracle compatibility check; not learner feedback.
assert(plan.train.every(t=>['recursive-lines','file-count'].includes(t.family)),'This preset requires audited B2 controls for every training family')
async function codeHashes(){
  return Object.fromEntries(await Promise.all(['./train-test.mjs','./train-test-protocol.js','./train-test-controls.js','./protocol.js','./dsh-backend.js','../../scripts/acceptance-network.js'].map(async path=>[path,createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex')])))
}
const manifest={codeHashes:await codeHashes(),protocol,sourceCommit,datasetHash:spec.datasetSha256,sourceFingerprint:fingerprint(view),spec,plan,conditions,kernelHash:KERNEL_HASH,image:starterImage,
  limitations:['Reused development data and declared curriculum order, not a sealed future audit or natural chronological traffic.','Same public fs1 filesystem across train/test; request/parameter generalization, not cross-repository generalization.','Training uses independent oracle references, including when the base answer was wrong.','B3 learns once from the whole training prefix; B4 learns after each training task. All test routers are frozen.','Test fallback to the fixed base agent is allowed and charged; router-only success is reported separately.','Gateway model alias does not establish fixed weights. Monetary prices unknown.']}
if(inspect){console.log(JSON.stringify({...manifest,modelCalls:0,fixtureFiles:Object.keys(files).length,fixtureBytes:Object.values(files).reduce((n,s)=>n+Buffer.byteLength(s),0)},null,2));process.exit(0)}
const experimentStart=performance.now()
const authFile=await realpath(resolve(args[0])),authStat=await lstat(authFile)
assert(authStat.isFile()&&!(authStat.mode&0o077),'Private auth file required')
const auth=JSON.parse(await readFile(authFile,'utf8')),output=resolve(args[4])
assert(typeof auth.apiKey==='string'&&auth.apiKey.length>0&&typeof auth.baseURL==='string'&&auth.baseURL.startsWith('https://'),'Auth requires API key and HTTPS endpoint')
assert(output!==source&&!output.startsWith(source+'/'),'Output must be outside exported source')
await mkdir(output,{recursive:false,mode:0o700})
const scratch=join(output,'.sandbox');await mkdir(scratch)
const plugin=fileURLToPath(new URL('../../',import.meta.url)),journal=join(output,'http.jsonl'),loader=join(output,'.network-loader.mjs')
await writeFile(journal,'',{mode:0o600})
await writeFile(loader,`process.env.ROUTER_ACCEPTANCE_AUTH=${JSON.stringify(authFile)};process.env.ROUTER_ACCEPTANCE_JOURNAL=${JSON.stringify(journal)};process.env.ROUTER_ACCEPTANCE_MAX_CALLS=${JSON.stringify(String(spec.maxHTTPCalls))};await import(${JSON.stringify(new URL('../../scripts/acceptance-network.js',import.meta.url).href)});`,{mode:0o600})
const stores={},report={...manifest,startedAt:new Date().toISOString(),model:auth.model??'deepseek-v4-flash',setup:[],runs:[],maintenance:[],stages:[],completed:false}
const redact=s=>String(s).replaceAll(auth.apiKey,'[REDACTED]')
async function writeJSON(path,value){await writeFile(path,redact(JSON.stringify(value,null,2)),{mode:0o600})}
async function save(){await writeJSON(join(output,'report.tmp'),report);await rename(join(output,'report.tmp'),join(output,'report.json'))}
async function events(){return(await readFile(journal,'utf8')).split('\n').filter(Boolean).map(JSON.parse)}
async function requestIds(){return(await events()).filter(e=>e.type==='request').map(e=>e.id)}
async function checkpoint(c,label){await writeJSON(join(output,`${c}-${label}-state.json`),await stores[c].read())}
function usage(rows,ids){
  const calls=ids.map(id=>{const r=rows.filter(e=>e.id===id&&['response','response-error'].includes(e.type)).at(-1);let u
    for(const line of(r?.body??r?.partialBody??'').split('\n'))if(line.startsWith('data: '))try{const v=JSON.parse(line.slice(6));if(v.usage)u=v.usage}catch{}
    return{id,known:Number.isFinite(u?.prompt_tokens)&&Number.isFinite(u?.completion_tokens),usage:u??null}
  })
  return{calls:ids.length,unknownUsageCalls:calls.filter(c=>!c.known).length,promptTokens:calls.reduce((n,c)=>n+(c.known?c.usage.prompt_tokens:0),0),outputTokens:calls.reduce((n,c)=>n+(c.known?c.usage.completion_tokens:0),0)}
}
async function task(c,t,phase){
  const store=stores[c],backend=join(output,`${c}-backend.json`)
  await writeJSON(backend,{root:store.root,image:starterImage,journal:join(output,`${c}-tools.jsonl`),...(['lines','file-count'].includes(t.oracle)?{answerContract:'integer-only'}:{})})
  const before=await requestIds(),priorTurns=(await store.read()).events.filter(e=>e.type==='object-agent-turn').length,start=performance.now();let proc
  try{proc=await processOutput(process.execPath,['--import',loader,join(plugin,'run.js'),'--auth-file',authFile,'--benchmark-file',backend,t.query],{cwd:store.root,timeoutMs:180000,maxOutputBytes:150000})}catch(e){proc={error:e.message,...e.processOutput}}
  const wallMs=performance.now()-start,state=await store.read(),newTurns=state.events.filter(e=>e.type==='object-agent-turn').slice(priorTurns),turn=newTurns.at(-1)
  const ids=(await requestIds()).filter(id=>!before.includes(id)),oracle=expected(t,view.files),copy=await snapshot(store.root,scratch);let unchanged
  try{unchanged=fingerprint(await inventory(copy))===manifest.sourceFingerprint}finally{await rm(copy,{recursive:true,force:true})}
  const row={condition:c,phase,index:t.index,category:t.category??null,query:t.query,oracle,process:proc,turn,wallMs,requestIds:ids,routed:turn?.routed??false,correct:proc.exitCode===0&&proc.stdout.trim()===oracle.trim(),sourceUnchanged:unchanged}
  report.runs.push(row);await save()
  assert(unchanged&&newTurns.length===1&&turn&&proc.exitCode===0,'Task execution/environment failed; retain results, do not retry test')
  assert(!row.routed||ids.length===0,'Routed task made model calls')
  return row
}
async function observe(c,t,row){
  // Trusted reference computed on actual input; never label a wrong model answer correct.
  await observeVerified(stores[c],{id:'train-'+t.index,family:t.family,request:t.query,output:row.oracle,oracle_id:`intercode-independent-reference-${t.index}`,verified:true,fixture:{files,args:t.oracle==='lines'?{extension:t.extension}:{}}})
}
const templateDigests={}
async function templates(c){
  const store=stores[c],state=await store.read(),known=plan.train.filter(t=>state.maintenance.histories['train-'+t.index])
  for(const family of new Set(known.map(t=>t.family))){
    const rows=known.filter(t=>t.family===family),digest=hash(rows)
    if(templateDigests[family]===digest)continue
    const s=await store.read(),ids=rows.map(t=>'train-'+t.index),registry=new RuleRegistry(store,{historyIds:ids}),dir=join(output,`B2-template-${family}-${rows.at(-1).index}`)
    await mkdir(dir);const pkg=await templatePackage(family,rows,ids,s.active[family]?.revision??null)
    for(const [name,text]of Object.entries(pkg))await writeFile(join(dir,name),text)
    const submitted=await registry.submit(dir),proof=await registry.validate(submitted.revision)
    assert(proof.passed,'Training-prefix template failed admission');await registry.activate(proof.validation_id,proof.generation);templateDigests[family]=digest
  }
}
async function learn(c,stage){
  const store=stores[c],before=await requestIds(),start=performance.now(),attempts=[]
  try{
    if(c==='B2'){await templates(c);return}
    await configureMaintenance(store,{enabled:true})
    const controller=new MaintenanceController(store,dshMaintenanceRunner(store,{authFile,loader}))
    for(let n=0;n<spec.attemptsPerStage*(stage.batch?plan.train.length:1);n++){
      const s=await store.read();if(Object.keys(s.maintenance.calls).length>=spec.maintenanceMaxCalls)break
      const chain=await controller.next();if(!chain)break
      await store.transaction(current=>{
        const ch=current.maintenance.chains[chain.id]
        ch.source_ids=Object.values(current.maintenance.histories).filter(h=>h.family===ch.rule_id).map(h=>h.id)
        ch.goal=trainingGoal(stage.position,stage.total,ch.rule_id)
        current.events.push({type:'benchmark-training-prefix',time:new Date().toISOString(),chain_id:ch.id,position:stage.position,source_ids:[...ch.source_ids]})
      })
      const result=await controller.run(chain.id);attempts.push(result);await checkpoint(c,`training-${stage.position}-attempt-${n+1}`)
      assert(result.status!=='ambiguous','Unresolved paid call; no automatic replay')
    }
  }finally{
    await configureMaintenance(store,{enabled:false})
    report.maintenance.push({condition:c,phase:'train',stage,wallMs:performance.now()-start,requestIds:(await requestIds()).filter(id=>!before.includes(id)),attempts})
    await save()
  }
}
await save()
try{
  const config={enabled:true,image:starterImage,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch,triggerTimeoutMs:5000,pids:64}
  report.preflight=await preflight(config);assert(report.preflight.ready,'Docker preflight failed')
  const seedHashes=[]
  for(const c of conditions){
    const start=performance.now(),root=join(output,c);await mkdir(root);await cp(source,root,{recursive:true});const store=stores[c]=new RuleStore(root)
    if(c==='B0'){await store.configure(config);await writeJSON(join(store.dir,'admission.json'),baseSuite)}else await installStarter(store,config)
    await configureMaintenance(store,{enabled:false,minHistory:1,maxCalls:spec.maintenanceMaxCalls,maxAttempts:2,timeoutMs:600000})
    const s=await store.read(),seedHash=hash(Object.fromEntries(Object.entries(s.active).map(([k,v])=>[k,v.revision])))
    if(c!=='B0')seedHashes.push(seedHash)
    report.setup.push({condition:c,wallMs:performance.now()-start,seedHash});await checkpoint(c,'initial');await save()
  }
  assert.equal(new Set(seedHashes).size,1,'Every routing control must start from identical seeds')
  const adapters=Object.fromEntries(conditions.map(c=>[c,{
    task:(t,p)=>task(c,t,p),observe:(t,r)=>observe(c,t,r),learn:s=>learn(c,s),checkpoint:label=>checkpoint(c,label),
    freeze:async()=>{const frozen=await freezeRouter(stores[c]);await writeJSON(join(output,`${c}-frozen.json`),frozen);return frozen},assertFrozen:f=>assertFrozen(stores[c],f)
  }]))
  await runTrainTest(plan,adapters,async row=>{report.stages.push(row.phase==='freeze'?row:{phase:row.phase,condition:row.condition,index:row.index,category:row.category,wallMs:row.wallMs});await save()})
  assert.deepEqual(await codeHashes(),manifest.codeHashes,'Benchmark code changed during experiment')
  report.completed=true
}catch(e){report.error=redact(e.message);process.exitCode=1}
finally{
  const all=await events();report.finishedAt=new Date().toISOString();report.physicalUsage=usage(all,all.filter(e=>e.type==='request').map(e=>e.id));report.summary={}
  for(const c of conditions){
    const rows=report.runs.filter(r=>r.condition===c),maintenance=report.maintenance.filter(r=>r.condition===c),setupMs=report.setup.find(r=>r.condition===c)?.wallMs??0
    const summarize=items=>({tasks:items.length,correct:items.filter(r=>r.correct).length,correctAutomation:items.filter(r=>r.routed&&r.correct).length,incorrectAutomation:items.filter(r=>r.routed&&!r.correct).length,fallbacks:items.filter(r=>!r.routed).length,wallMs:items.reduce((n,r)=>n+r.wallMs,0),usage:usage(all,items.flatMap(r=>r.requestIds))})
    const train=summarize(rows.filter(r=>r.phase==='train')),test=summarize(rows.filter(r=>r.phase==='test')),maintenanceMs=maintenance.reduce((n,r)=>n+r.wallMs,0)
    const phaseMs=phase=>report.stages.filter(r=>r.condition===c&&phase.includes(r.phase)).reduce((n,r)=>n+(r.wallMs??0),0),trainPipelineMs=phaseMs(['train','train-batch']),testPipelineMs=phaseMs(['test']),freezeMs=phaseMs(['freeze'])
    report.summary[c]={train,test,testCategories:Object.fromEntries(['new-wording','new-parameter','unseen-family'].map(k=>[k,summarize(rows.filter(r=>r.phase==='test'&&r.category===k))])),setupMs,maintenanceMs,trainPipelineMs,testPipelineMs,freezeMs,totalMs:setupMs+trainPipelineMs+testPipelineMs+freezeMs,workspaceMutations:rows.filter(r=>!r.sourceUnchanged).length,unsafeAutomation:null,totalUsage:usage(all,[...rows.flatMap(r=>r.requestIds),...maintenance.flatMap(r=>r.requestIds)]),monetaryCost:null}
  }
  report.observedRunMs=performance.now()-experimentStart
  report.sharedAndReportingMs=report.observedRunMs-Object.values(report.summary).reduce((n,s)=>n+s.totalMs,0)
  await save();console.log(JSON.stringify({output,completed:report.completed,error:report.error,physicalUsage:report.physicalUsage},null,2))
}
