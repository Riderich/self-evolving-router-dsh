// Autonomous development experiment. No family labels, gold commands, evaluator answers or fixtures enter agent histories.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,readdir,rm,rename} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {CapabilityStore,CapabilityRouter,checkFrozen} from '../../lib/v2/core.js'
import {installSeed,develop} from '../../lib/v2/runner.js'
import {templates} from './v2-controls.js'
import {processOutput,requestSnapshot} from '../../lib/rule-worker.js'
import {inventory,fingerprint,expected,sourceCommit} from './protocol.js'
import {hash} from '../../lib/rule-contract.js'
const inspect=process.argv[2]==='--inspect',args=process.argv.slice(inspect?3:2);assert.equal(args.length,inspect?2:4,'--inspect DATA FS | AUTH DATA FS NEW_OUTPUT')
const [dataFile,source]=(inspect?args:args.slice(1,3)).map(resolvePath=>resolve(resolvePath)),raw=await readFile(dataFile);assert.equal(createHash('sha256').update(raw).digest('hex'),'60f88e1aacc7ebba535093f9890c5c33203f4e5f32958e0e94fbe90ec4f01c82');const data=JSON.parse(raw),view=await inventory(source),files=Object.fromEntries(Object.entries(view.files).map(([p,b])=>[p,new TextDecoder('utf-8',{fatal:true}).decode(b)]))
const plan={train:[{id:'original-20',query:data[20].query,oracle:'lines',extension:'c'},{id:'original-22',query:data[22].query,oracle:'lines',extension:'php'},{id:'original-33',query:data[33].query,oracle:'file-count'}],test:[
 {id:'original-wording-28',query:data[28].query,oracle:'lines',extension:'php'},
 {id:'original-wording-56',query:data[56].query,oracle:'lines',extension:'java'},
 {id:'new-count-wording',query:'How many regular files are there in /testbed and subdirectories?',oracle:'file-count'},
 {id:'new-count-exclusion',query:'Count all files in /testbed recursively excluding archive',oracle:'file-count',exclude:'archive'},
 {id:'new-count-chinese',query:'递归统计 /testbed 下所有文件的数量',oracle:'file-count'},
 {id:'original-wording-17',query:data[17].query,oracle:'prefix-hex'}]}
const conditions=['B0','B1','B2','B3','B4'],image='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',maxHTTPCalls=512,maxDevelopmentCalls=64
const variants={...files,'transfer/extra.php':'a\nb\nc\n','transfer/Extra.java':'extra\n','archive/ignore.txt':'ignore'}
function fixture(t,phase){return phase==='train'?files:variants}
function oracle(t,f){return expected(t,t.exclude?Object.fromEntries(Object.entries(f).filter(([p])=>!p.split('/').slice(0,-1).includes(t.exclude))):f)}
const manifest={protocol:'autonomous-v2-development-v1',sourceCommit,datasetHash:createHash('sha256').update(raw).digest('hex'),sourceFingerprint:fingerprint(view),plan,conditions,maxHTTPCalls,maxDevelopmentCalls,image,trainFixtureHash:hash(files),testFixtureHash:hash(variants),limitations:['Exploratory development data; reused original wording plus predeclared authored variants and altered public filesystem, not sealed or official InterCode score.','Independent evaluator never supplies families, correct answers or fixtures to development. Histories contain observed outputs, not verified success.','Same frozen base fallback; B3/B4 have equal cumulative development call caps, actual attempts differ.','Agent-authored development checks are not independent correctness evidence.','No known monetary price or fixed-weight guarantee for gateway alias.']}
const tracked=['v2-benchmark.mjs','v2-controls.js','v2-network.js','dsh-backend.js','../../lib/v2/core.js','../../lib/v2/development.js','../../lib/v2/plugin.js','../../lib/v2/runner.js','../../run.js','../../lib/runtime.js','../../index.js','../../lib/rule-worker.js','../../lib/rule-contract.js','../../lib/executor.js','../../examples/capabilities/files/parser.py','../../examples/capabilities/files/executor.py','../../examples/capabilities/files/manifest.json','../../examples/capabilities/files/CONTRACT.md','../../examples/capabilities/files/tests/cases.json']
async function codeHashes(){return Object.fromEntries(await Promise.all(tracked.map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,import.meta.url))).digest('hex')])))}
manifest.codeHashes=await codeHashes();if(inspect){console.log(JSON.stringify({...manifest,modelCalls:0},null,2));process.exit(0)}
const output=resolve(args[3]);await mkdir(output,{recursive:false,mode:0o700});const scratch=join(output,'.sandbox');await mkdir(scratch);const authFile=resolve(args[0]),auth=JSON.parse(await readFile(authFile,'utf8')),journal=join(output,'http.jsonl'),loader=join(output,'loader.mjs');await writeFile(journal,'',{mode:0o600});await writeFile(loader,`process.env.ROUTER_ACCEPTANCE_AUTH=${JSON.stringify(authFile)};process.env.ROUTER_ACCEPTANCE_JOURNAL=${JSON.stringify(journal)};process.env.ROUTER_ACCEPTANCE_MAX_CALLS='512';await import(${JSON.stringify(new URL('./v2-network.js',import.meta.url).href)})`,{mode:0o600})
const started=performance.now(),report={...manifest,startedAt:new Date().toISOString(),model:auth.model??'deepseek-v4-flash',setup:[],runs:[],maintenance:[],freezes:{},completed:false},stores={};const redact=s=>s.replaceAll(auth.apiKey,'[REDACTED]')
async function save(){await writeFile(join(output,'report.tmp'),redact(JSON.stringify(report,null,2)),{mode:0o600});await rename(join(output,'report.tmp'),join(output,'report.json'))}
async function ledger(){return (await readFile(journal,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}
async function ids(){return (await ledger()).filter(e=>e.type==='request').map(e=>e.id)}
async function checkpoint(c,label){await writeFile(join(output,`${c}-${label}.json`),JSON.stringify(await stores[c].read(),null,2),{mode:0o600})}
async function reset(root,f){for(const name of await readdir(root))if(name!=='.dsh')await rm(join(root,name),{recursive:true,force:true});for(const [p,text]of Object.entries(f)){await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),text)}}
async function task(c,t,phase){
 const store=stores[c],f=fixture(t,phase);await reset(store.root,f);const snap=await requestSnapshot(store.root,(await store.read()).config);let beforeHash;try{beforeHash=fingerprint(await inventory(snap.path))}finally{await snap.dispose()}
 const backend=join(output,`${c}-backend.json`),toolsLog=join(output,`${c}-tools.jsonl`);await writeFile(backend,JSON.stringify({root:store.root,image,journal:toolsLog,answerContract:t.oracle==='prefix-hex'?'hex':'integer-only'}));let previousTools=[];try{previousTools=(await readFile(toolsLog,'utf8')).split('\n').filter(Boolean)}catch{}
 const previous=(await store.read()).events.filter(e=>e.type==='capability-agent-turn').length,before=await ids(),start=performance.now();let proc
 try{proc=await processOutput(process.execPath,['--import',loader,fileURLToPath(new URL('../../run.js',import.meta.url)),'--auth-file',authFile,'--benchmark-file',backend,t.query],{cwd:store.root,timeoutMs:180000,maxOutputBytes:100000})}catch(e){proc={error:e.message,...e.processOutput}}
 const state=await store.read(),turns=state.events.filter(e=>e.type==='capability-agent-turn').slice(previous),turn=turns.at(-1),after=await requestSnapshot(store.root,state.config);let unchanged;try{unchanged=fingerprint(await inventory(after.path))===beforeHash}finally{await after.dispose()}
 const row={condition:c,phase,id:t.id,query:t.query,expected:oracle(t,f),process:proc,routed:turn?.routed??false,turn,correct:proc.exitCode===0&&proc.stdout.trim()===oracle(t,f).trim(),wallMs:performance.now()-start,requestIds:(await ids()).filter(id=>!before.includes(id)),sourceUnchanged:unchanged};report.runs.push(row);await save();assert(unchanged&&turns.length===1&&proc.exitCode===0,'Task interrupted; retain original failure, no test retry');assert(!row.routed||row.requestIds.length===0,'Routed task called model')
 if(phase==='train'&&['B2','B3','B4'].includes(c)){let trace=[];try{trace=(await readFile(toolsLog,'utf8')).split('\n').filter(Boolean).slice(previousTools.length).map(JSON.parse)}catch{}await store.observe({id:t.id,request:t.query,output:proc.stdout,trajectory:trace,route:{routed:row.routed,...Object.fromEntries(Object.entries(state.events.filter(e=>e.type==='capability-route').at(-1)??{}).filter(([k])=>['kind','reason','task','program'].includes(k)))}})}
 return row
}
async function learn(c,position){const start=performance.now(),before=await ids();let result
 try{if(c==='B2')await templates(stores[c]);else{const s=await stores[c].read(),used=Object.values(s.sessions).reduce((n,x)=>n+x.calls.length,0),remaining=maxDevelopmentCalls-used;if(remaining>0)result=await develop(stores[c],{authFile,loader,maxCalls:remaining});else result={status:'budget-exhausted'};assert(result.status!=='ambiguous','Unresolved development call')}}
 finally{report.maintenance.push({condition:c,position,result,wallMs:performance.now()-start,requestIds:(await ids()).filter(id=>!before.includes(id))});await checkpoint(c,'train-'+position);await save()}}
function usage(all,ids){let input=0,output=0,unknown=0;for(const id of ids){const r=all.filter(e=>e.id===id&&['response','response-error'].includes(e.type)).at(-1);let u;for(const line of(r?.body??r?.partialBody??'').split('\n'))if(line.startsWith('data: '))try{const v=JSON.parse(line.slice(6));if(v.usage)u=v.usage}catch{}if(u){input+=u.prompt_tokens;output+=u.completion_tokens}else unknown++}return {calls:ids.length,inputTokens:input,outputTokens:output,unknownUsageCalls:unknown}}
await save()
try{
 const config={enabled:true,image,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch,pids:64,triggerTimeoutMs:5000}
 for(const c of conditions){const start=performance.now(),root=join(output,c);await mkdir(root);await reset(root,files);const store=stores[c]=new CapabilityStore(root);if(c==='B0')await store.configure(config);else await installSeed(store,config);report.setup.push({condition:c,wallMs:performance.now()-start,seedHash:hash((await store.read()).active)});await checkpoint(c,'initial');await save()}
 assert.equal(new Set(report.setup.filter(x=>x.condition!=='B0').map(x=>x.seedHash)).size,1)
 for(const [i,t]of plan.train.entries())for(const c of conditions){await task(c,t,'train');if(['B2','B4'].includes(c))await learn(c,i+1);await checkpoint(c,'after-'+t.id)}
 await learn('B3',3)
 for(const c of conditions){report.freezes[c]=await stores[c].freeze();await checkpoint(c,'frozen');await save()}
 for(const t of plan.test)for(const c of conditions){await checkFrozen(stores[c],report.freezes[c]);try{await task(c,t,'test')}finally{await checkFrozen(stores[c],report.freezes[c])}}
 assert.deepEqual(await codeHashes(),manifest.codeHashes,'Source changed during experiment');report.completed=true
}catch(e){report.error=e.message;process.exitCode=1}
finally{const all=await ledger();report.physicalUsage=usage(all,all.filter(e=>e.type==='request').map(e=>e.id));report.summary={};for(const c of conditions){const runs=report.runs.filter(x=>x.condition===c),maintenance=report.maintenance.filter(x=>x.condition===c),summarize=phase=>{const rows=runs.filter(x=>x.phase===phase);return {tasks:rows.length,correct:rows.filter(x=>x.correct).length,correctAutomation:rows.filter(x=>x.correct&&x.routed).length,incorrectAutomation:rows.filter(x=>!x.correct&&x.routed).length,usage:usage(all,rows.flatMap(x=>x.requestIds)),wallMs:rows.reduce((n,x)=>n+x.wallMs,0)}};report.summary[c]={train:summarize('train'),test:summarize('test'),maintenanceUsage:usage(all,maintenance.flatMap(x=>x.requestIds)),maintenanceMs:maintenance.reduce((n,x)=>n+x.wallMs,0),setupMs:report.setup.find(x=>x.condition===c)?.wallMs??0,totalUsage:usage(all,[...runs.flatMap(x=>x.requestIds),...maintenance.flatMap(x=>x.requestIds)]),unsafeAutomation:null,monetaryCost:null}}report.observedWallMs=performance.now()-started;report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({completed:report.completed,error:report.error,usage:report.physicalUsage,output},null,2))}
