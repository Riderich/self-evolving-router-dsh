// Explicit paid engineering acceptance, not a benchmark or few-shot ablation.
// AUTH NEW_OUTPUT; maximum 20 actual model requests, fresh output, no blind resume.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, unlink, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleStore } from '../lib/rule-store.js'
import { installStarter, starterImage } from '../lib/starter-router.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { observeVerified, configureMaintenance } from '../lib/maintenance-state.js'
import { MaintenanceController } from '../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../lib/maintenance-runner.js'
import { processOutput } from '../lib/rule-worker.js'
import { KERNEL_HASH, hash } from '../lib/rule-contract.js'
assert(process.argv[2]&&process.argv[3],'AUTH NEW_OUTPUT required; this makes paid calls')
const authFile=await realpath(resolve(process.argv[2])),authStat=await lstat(authFile)
assert(authStat.isFile()&&!(authStat.mode&0o077),'Private auth file required')
const maxCalls=Number(process.env.ROUTER_STARTER_MAX_CALLS??20);assert(Number.isSafeInteger(maxCalls)&&maxCalls>=1&&maxCalls<=20,'Call cap must be 1..20')
const auth=JSON.parse(await readFile(authFile,'utf8')),output=resolve(process.argv[3])
await mkdir(output,{recursive:false,mode:0o700})
const root=join(output,'task-workspace'),scratch=join(output,'.sandbox');await mkdir(root);await mkdir(scratch)
const store=new RuleStore(root),installed=await installStarter(store,{enabled:true,image:starterImage,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'',snapshotDirectory:scratch,triggerTimeoutMs:5000,pids:64})
const initial=await store.read();await writeFile(join(output,'initial-state.json'),JSON.stringify(initial,null,2))
await writeFile(join(root,'initial.txt'),'fixture')
const before={list:await new ObjectRouter(root).route('list visible files'),count:await new ObjectRouter(root).route('count visible files'),newPhrase:await new ObjectRouter(root).route('show visible files')}
assert.equal(before.list.text,'initial.txt\n');assert.equal(before.count.text,'1\n');assert.equal(before.newPhrase.kind,'fallback');await unlink(join(root,'initial.txt'))
for(const [i,request]of ['show visible files','display visible files','show visible files'].entries()){
 const name=`history-${i}.txt`;await writeFile(join(root,name),'fixture')
 // Trusted actual directory evaluator; hidden router state and dirs excluded.
 const entries=await (await import('node:fs/promises')).readdir(root,{withFileTypes:true})
 const text=entries.filter(e=>!e.name.startsWith('.')&&e.isFile()).map(e=>e.name).sort().map(n=>n+'\n').join('')
 await observeVerified(store,{id:`starter-history-${i}`,family:'list-files',request,output:text,oracle_id:`host-public-directory-${i}`,verified:true,fixture:{files:{[name]:'fixture'},args:{}}})
 await writeFile(join(output,`history-${i}.json`),JSON.stringify({request,files:{[name]:'fixture'},output:text}));await unlink(join(root,name))
}
await configureMaintenance(store,{enabled:true,maxCalls,maxAttempts:2,timeoutMs:600000})
const journal=join(output,'http.jsonl'),loader=join(output,'.network-loader.mjs');await writeFile(journal,'',{mode:0o600})
await writeFile(loader,`process.env.ROUTER_ACCEPTANCE_AUTH=${JSON.stringify(authFile)};process.env.ROUTER_ACCEPTANCE_JOURNAL=${JSON.stringify(journal)};process.env.ROUTER_ACCEPTANCE_MAX_CALLS=${JSON.stringify(String(maxCalls))};await import(${JSON.stringify(new URL('./acceptance-network.js',import.meta.url).href)});`,{mode:0o600})
const controller=new MaintenanceController(store,dshMaintenanceRunner(store,{authFile,loader})),chain=await controller.next();assert(chain)
const manifest={startedAt:new Date().toISOString(),model:auth.model??'deepseek-v4-flash',kernelHash:KERNEL_HASH,installed,maxCalls,chainId:chain.id,baseRevision:chain.base_revision,initialActive:initial.active,kind:'synthetic engineering acceptance; working router doubles as few-shot; no causal efficacy claim'}
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2))
let result
for(let i=0;i<2;i++){result=await controller.run(chain.id);await writeFile(join(output,`attempt-${i+1}.json`),JSON.stringify(result,null,2));if(result.status!=='retry')break}
await writeFile(join(root,'new-after-learning.txt'),'new')
const routes={}
for(const request of ['list visible files','show visible files','display visible files','count visible files','list visible files in dir1','show visible files excluding new-after-learning.txt'])routes[request]=await new ObjectRouter(root).route(request)
const attempts=join(root,'.network-attempts'),deny=join(root,'.deny-network.mjs');await writeFile(attempts,'')
await writeFile(deny,`import{appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(attempts)},'attempt\\n');throw Error('NETWORK_FORBIDDEN')}`)
let dsh
try{dsh=await processOutput(process.execPath,['--import',deny,fileURLToPath(new URL('../run.js',import.meta.url)),'show visible files'],{cwd:root,timeoutMs:180000})}catch(e){dsh={error:e.message,...e.processOutput}}
const state=await store.read(),calls=Object.values(state.maintenance.calls),http=(await readFile(journal,'utf8')).split('\n').filter(Boolean).map(JSON.parse)
const revision=state.active['list-files']?.revision
const summary={...manifest,finishedAt:new Date().toISOString(),status:result.status,lastError:result.lastError,before,routes,dsh,networkAttempts:await readFile(attempts,'utf8'),calls:calls.length,httpRequests:http.filter(e=>e.type==='request').length,
 unknownUsage:calls.filter(c=>!c.usage).length,usage:Object.fromEntries(['inputTokens','cacheReadTokens','cacheWriteTokens','outputTokens'].map(k=>[k,calls.reduce((n,c)=>n+(c.usage?.[k]??0),0)])),
 parentPreserved:revision&&JSON.parse(state.packages[revision].files['manifest.json']).parent_revision===chain.base_revision,
 executorUnchanged:revision&&hash(state.packages[revision].files['executor.py'])===hash(initial.packages[chain.base_revision].files['executor.py']),otherRevisionsUnchanged:['count-files','recursive-lines'].every(k=>state.active[k]?.revision===initial.active[k].revision)}
summary.passed=result.status==='complete'&&['list visible files','show visible files','display visible files'].every(q=>routes[q].text==='new-after-learning.txt\n')&&routes['count visible files'].text==='1\n'&&['list visible files in dir1','show visible files excluding new-after-learning.txt'].every(q=>routes[q].kind==='fallback')&&summary.parentPreserved&&summary.otherRevisionsUnchanged&&dsh.exitCode===0&&dsh.stdout.trim()==='new-after-learning.txt'&&summary.networkAttempts===''
await writeFile(join(output,'state.json'),JSON.stringify(state,null,2));await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({output,passed:summary.passed,calls:summary.calls,status:summary.status,parentPreserved:summary.parentPreserved,executorUnchanged:summary.executorUnchanged,usage:summary.usage},null,2))
if(!summary.passed)process.exitCode=2
