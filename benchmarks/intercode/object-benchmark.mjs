// Paid, serial development benchmark. New output directory required; no blind resume.
// node benchmarks/intercode/object-benchmark.mjs AUTH DATA_JSON EXPORTED_FS1 NEW_OUTPUT
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, cp, rm, realpath, lstat, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { RuleStore } from '../../lib/rule-store.js'
import { RuleRegistry } from '../../lib/rule-registry.js'
import { ObjectRouter } from '../../lib/rule-router.js'
import { configureMaintenance, observeVerified } from '../../lib/maintenance-state.js'
import { MaintenanceController } from '../../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../../lib/maintenance-runner.js'
import { processOutput } from '../../lib/rule-worker.js'
import { preflight } from '../../lib/rule-preflight.js'
import { snapshot, DockerExecutor } from '../../lib/executor.js'
import { validateConfig } from '../../lib/schema.js'
import { KERNEL_HASH, hash } from '../../lib/rule-contract.js'
import { sourceCommit, inventory, fingerprint, expected } from './protocol.js'
import { runtimeImage, objectStream, objectSuite, controlPackage, boundaries } from './object-protocol.js'
assert(process.argv.length === 6, 'Required: AUTH DATA_JSON EXPORTED_FS1 NEW_OUTPUT')
const [authFile, dataFile, source] = await Promise.all(process.argv.slice(2,5).map(p => realpath(resolve(p))))
const stat = await lstat(authFile); assert(stat.isFile() && !(stat.mode & 0o077), 'Auth must be private')
const auth = JSON.parse(await readFile(authFile, 'utf8')), output = resolve(process.argv[5])
const raw = await readFile(dataFile), data = JSON.parse(raw), stream = objectStream(data), view = await inventory(source)
const plugin = fileURLToPath(new URL('../../', import.meta.url)), stores = {}, conditions = ['B0','B1','B2','B3','B4']
await mkdir(output, { recursive: false, mode: 0o700 })
const scratch = join(output,'.sandbox'); await mkdir(scratch)
const journal = join(output, 'http.jsonl'), loader = join(output, '.network-loader.mjs')
await writeFile(journal,'',{mode:0o600})
await writeFile(loader, `process.env.ROUTER_ACCEPTANCE_AUTH=${JSON.stringify(authFile)};process.env.ROUTER_ACCEPTANCE_JOURNAL=${JSON.stringify(journal)};process.env.ROUTER_ACCEPTANCE_MAX_CALLS='64';await import(${JSON.stringify(new URL('../../scripts/acceptance-network.js',import.meta.url).href)});`,{mode:0o600})
const report = { protocol:'intercode-rule-objects-dev-v1', startedAt:new Date().toISOString(), sourceCommit, datasetHash:createHash('sha256').update(raw).digest('hex'), sourceFingerprint:fingerprint(view),
  model:auth.model??'deepseek-v4-flash', image:runtimeImage, kernelHash:KERNEL_HASH, maxHTTPCalls:64, initialMaintenanceCap:20, evolvingCumulativeMaintenanceCap:32,
  stream, admissionHash:hash(objectSuite(stream.slice(0,3))), conditions, runs:[], maintenance:[], shared:[], boundaries:[], stages:[], completed:false,
  limitations:['Previously used development tasks; not sealed or natural chronological traffic.','Pinned InterCode data exported into public read-only view; independent exact output oracle, not official leaderboard reward.',
    'B1 sees all selected request forms, an optimistic handwritten control. B2 uses past wording templates and a handwritten executor.',
    'Single run, one family, two future-original opportunities; no statistical or net monetary saving claim.','Same gateway alias does not prove fixed model weights. Prices unknown. Shared stages charged to every logical condition.'] }
const redact = s => String(s).replaceAll(auth.apiKey,'[REDACTED]')
async function save() { const p=join(output,'report.json'); await writeFile(p+'.tmp',redact(JSON.stringify(report,null,2)),{mode:0o600});await rename(p+'.tmp',p) }
async function network() { return (await readFile(journal,'utf8')).split('\n').filter(Boolean).map(JSON.parse) }
async function requests() { return (await network()).filter(e=>e.type==='request').map(e=>e.id) }
async function stage(label, fn) {
  const row={label,status:'running',startedAt:new Date().toISOString()};report.stages.push(row);await save()
  try {const result=await fn();row.status='complete';return result} catch(e){row.status='failed';row.error=redact(e.message);throw e} finally {row.finishedAt=new Date().toISOString();await save()}
}
async function stateCopy(c,label) { await writeFile(join(output,`${c}-${label}-state.json`),redact(JSON.stringify(await stores[c].read(),null,2)),{mode:0o600}) }
async function prepare(c) {
  const root=join(output,c);await mkdir(root);await cp(source,root,{recursive:true})
  stores[c]=new RuleStore(root)
  await stores[c].configure({enabled:true,image:runtimeImage,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch,triggerTimeoutMs:5000,pids:64})
  await configureMaintenance(stores[c],{enabled:false,maxCalls:20,maxAttempts:2,timeoutMs:600000})
  await writeFile(join(stores[c].dir,'admission.json'),JSON.stringify(objectSuite(c==='B1'?stream:stream.slice(0,3))))
  await writeFile(join(output,`${c}-backend.json`),JSON.stringify({root,image:runtimeImage,journal:join(output,`${c}-tools.jsonl`),answerContract:'integer-only'}))
}
async function task(c,t) {
  const before=await requests(), start=performance.now()
  const proc=await processOutput(process.execPath,['--import',loader,join(plugin,'run.js'),'--auth-file',authFile,'--benchmark-file',join(output,`${c}-backend.json`),t.query],{cwd:stores[c].root,timeoutMs:120000,maxOutputBytes:150000})
  const wallMs=performance.now()-start, state=await stores[c].read(), turn=state.events.filter(e=>e.type==='object-agent-turn').at(-1)
  const requestIds=(await requests()).filter(id=>!before.includes(id)), oracle=expected(t,view.files)
  const copy=await snapshot(stores[c].root,scratch);let unchanged
  try{unchanged=fingerprint(await inventory(copy))===report.sourceFingerprint}finally{await rm(copy,{recursive:true,force:true})}
  const row={condition:c,index:t.index,query:t.query,oracle,wallMs,process:proc,turn,requestIds,httpRequests:requestIds.length,routed:turn?.routed??false,
    correct:proc.exitCode===0 && proc.stdout.trim()===oracle.trim(),sourceUnchanged:unchanged}
  report.runs.push(row);await stateCopy(c,String(t.index));await save()
  console.log(JSON.stringify({stage:'task',condition:c,index:t.index,correct:row.correct,routed:row.routed,calls:requestIds.length,wallMs}))
  assert(unchanged && turn && proc.exitCode===0,'Execution/environment integrity failure')
  assert(!row.routed || requestIds.length===0,'Routed turn made model call')
  return row
}
async function observe(c,row) {
  if(row.correct) await observeVerified(stores[c],{id:`verified-${row.index}`,family:'recursive-lines',request:row.query,output:row.process.stdout.trim(),oracle_id:`intercode-independent-newline-oracle-${row.index}`,verified:true})
}
async function control(c,rows,label) {
  const start=performance.now(),store=stores[c],reg=new RuleRegistry(store),state=await store.read()
  const id=`manual-${c.toLowerCase()}`;await reg.addSource(id,{kind:'manual-control',reference:`${report.protocol}:${c}:handwritten executor and wording templates`})
  const dir=join(output,`${c}-${label}-package`);await mkdir(dir)
  const files=controlPackage(rows,[id],state.active['recursive-lines']?.revision??null)
  for(const [name,text]of Object.entries(files))await writeFile(join(dir,name),text)
  const submission=await reg.submit(dir), proof=await reg.validate(submission.revision)
  const row={condition:c,label,kind:'manual-validation',proof,httpRequests:0,requestIds:[]}
  if(proof.passed)await reg.activate(proof.validation_id,submission.generation)
  row.wallMs=performance.now()-start;report.maintenance.push(row);await stateCopy(c,label);await save()
  assert(proof.passed,`${c} manual control failed admission`)
}
async function maintain(c,label,continuation=false) {
  const store=stores[c],before=await requests(),start=performance.now()
  await configureMaintenance(store,{enabled:true,maxCalls:continuation?32:20,maxAttempts:continuation?4:2})
  // Predeclared B4 budget extension retains the original failed chain and feedback.
  if(continuation) await store.transaction(s=>{
    const old=Object.values(s.maintenance.chains).find(x=>x.status==='stopped'&&!x.promoted_revision)
    if(old && !Object.values(s.maintenance.calls).some(x=>x.chain_id===old.id&&['started','ambiguous'].includes(x.status))) {
      old.status='retry';s.events.push({type:'benchmark-budget-extension',time:new Date().toISOString(),chain_id:old.id,maxCalls:32})
    }
  })
  const controller=new MaintenanceController(store,dshMaintenanceRunner(store,{authFile,loader})),chain=await controller.next(), attempts=[]
  if(chain)for(let n=0;n<2;n++){const result=await controller.run(chain.id);attempts.push(result);await stateCopy(c,`${label}-attempt-${n+1}`);if(result.status!=='retry')break}
  await configureMaintenance(store,{enabled:false})
  const requestIds=(await requests()).filter(id=>!before.includes(id)),s=await store.read()
  report.maintenance.push({condition:c,label,kind:'model-maintenance',wallMs:performance.now()-start,requestIds,httpRequests:requestIds.length,attempts,active:s.active})
  await stateCopy(c,label);await save()
  console.log(JSON.stringify({stage:'maintenance',condition:c,label,calls:requestIds.length,status:attempts.at(-1)?.status,active:s.active}))
  assert(!attempts.some(a=>a.status==='ambiguous'),'Unresolved paid call: preserve evidence, no automatic replay')
}
function usage(events, ids) {
  const rows=ids.map(id=>{
    const response=events.filter(e=>e.id===id&&['response','response-error'].includes(e.type)).at(-1);let u
    for(const line of (response?.body??response?.partialBody??'').split('\n'))if(line.startsWith('data: '))try{const v=JSON.parse(line.slice(6));if(v.usage)u=v.usage}catch{}
    return {id,known:Number.isFinite(u?.prompt_tokens)&&Number.isFinite(u?.completion_tokens),usage:u??null,status:response?.status??null}
  })
  return {calls:ids.length,unknownUsageCalls:rows.filter(r=>!r.known).length,promptTokens:rows.reduce((n,r)=>n+(r.known?r.usage.prompt_tokens:0),0),outputTokens:rows.reduce((n,r)=>n+(r.known?r.usage.completion_tokens:0),0),rows}
}
console.log(JSON.stringify({output,maxHTTPCalls:64,originalTasks:5,syntheticTasks:0,futureOpportunities:2}))
report.codeHashes = {}
for (const name of ['benchmarks/intercode/object-benchmark.mjs','benchmarks/intercode/object-protocol.js','benchmarks/intercode/dsh-backend.js','scripts/acceptance-network.js']) report.codeHashes[name] = createHash('sha256').update(await readFile(join(plugin,name))).digest('hex')
await save()
try {
  await stage('prepare',async()=>{for(const c of conditions)await prepare(c)
    const check=await preflight((await stores.B0.read()).config);report.preflight=check;assert(check.ready,'Docker preflight failed')
    const cfg=validateConfig({image:runtimeImage,dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch})
    const probe=await new DockerExecutor().execute({requires:['bash','find','wc','cat'],script:'printf ready'},[],stores.B0.root,cfg)
    assert.equal(probe.stdout,'ready');assert.equal(probe.exitCode,0)
  })
  await stage('B1-static-admission',()=>control('B1',stream,'static'))
  await stage('verified-prefix',async()=>{
    for(const t of stream.slice(0,3)){const row=await task('B0',t);await observe('B0',row);await task('B1',t)}
    const prefix=report.runs.filter(r=>r.condition==='B0');assert(prefix.every(r=>r.correct),'Insufficient verified prefix; stop instead of fabricating histories')
    for(const c of ['B2','B3','B4']){for(const row of prefix)await observe(c,row);report.shared.push({condition:c,source:'B0',indices:[20,22,28],charged:true})}
  })
  await stage('B2-prefix-templates',()=>control('B2',stream.slice(0,3),'prefix'))
  await stage('initial-learning',()=>maintain('B3','initial'))
  await stage('freeze-and-clone',async()=>{
    // Paths in the package/draft state are relative; old process logs remain provenance only.
    await rm(stores.B4.dir,{recursive:true,force:true});await cp(stores.B3.dir,stores.B4.dir,{recursive:true})
    report.shared.push({condition:'B4',source:'B3',maintenance:'initial',charged:true,stateHash:hash(await stores.B3.read())})
    await stateCopy('B4','initial-clone')
  })
  for(const t of stream.slice(3)) {
    await stage(`future-${t.index}`,async()=>{for(const c of t.index===56?[...conditions].reverse():conditions){const row=await task(c,t);if(c==='B4'||c==='B2')await observe(c,row)}})
    if(t.index===40) {
      await stage('B2-update-40',async()=>{
        const histories=(await stores.B2.read()).maintenance.histories
        if(histories['verified-40'])await control('B2',stream.filter(t=>histories[`verified-${t.index}`]),'update-40')
      })
      await stage('B4-update-40',()=>maintain('B4','update-40',true))
    }
  }
  await stage('boundary-diagnostics',async()=>{
    for(const c of ['B1','B2','B3','B4'])for(const request of boundaries){const start=performance.now(),r=await new ObjectRouter(stores[c].root).route(request);report.boundaries.push({condition:c,request,result:r,wallMs:performance.now()-start});await save()}
    // These post-stream checks do not feed the learner and are not task successes.
  })
  report.completed=true
} catch(e) { report.error=redact(e.message);process.exitCode=1 }
finally {
  report.finishedAt=new Date().toISOString();const events=await network();report.physicalUsage=usage(events,events.filter(e=>e.type==='request').map(e=>e.id));report.summary={}
  for(const c of conditions){
    const rows=[...report.runs.filter(r=>r.condition===c),...(['B2','B3','B4'].includes(c)?report.runs.filter(r=>r.condition==='B0'&&[20,22,28].includes(r.index)):[])]
    const lifecycle=[...report.maintenance.filter(m=>m.condition===c),...(c==='B4'?report.maintenance.filter(m=>m.condition==='B3'&&m.label==='initial'):[])]
    const future=rows.filter(r=>[40,56].includes(r.index)),requestMs=rows.reduce((n,r)=>n+r.wallMs,0),maintenanceMs=lifecycle.reduce((n,m)=>n+m.wallMs,0)
    report.summary[c]={tasks:rows.length,correct:rows.filter(r=>r.correct).length,routed:rows.filter(r=>r.routed).length,correctAutomation:rows.filter(r=>r.routed&&r.correct).length,incorrectAutomation:rows.filter(r=>r.routed&&!r.correct).length,
      futureTasks:future.length,futureCorrectAutomation:future.filter(r=>r.routed&&r.correct).length,requestMs,maintenanceMs,totalMs:requestMs+maintenanceMs,
      usage:usage(events,[...rows.flatMap(r=>r.requestIds),...lifecycle.flatMap(m=>m.requestIds)]),monetaryCost:null}
    if(stores[c])await stateCopy(c,'final')
  }
  await save();console.log(JSON.stringify({output,completed:report.completed,error:report.error,physicalCalls:report.physicalUsage.calls,summary:Object.fromEntries(Object.entries(report.summary).map(([k,v])=>[k,{...v,usage:{...v.usage,rows:undefined}}]))},null,2))
}
