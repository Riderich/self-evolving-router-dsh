// Explicit, paid engineering acceptance. Never included in npm test.
// Usage: node scripts/live-object-acceptance.mjs PRIVATE_AUTH NEW_OUTPUT_DIRECTORY
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, readdir, unlink, realpath, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleStore } from '../lib/rule-store.js'
import { configureMaintenance, observeVerified } from '../lib/maintenance-state.js'
import { MaintenanceController } from '../lib/maintenance-controller.js'
import { dshMaintenanceRunner } from '../lib/maintenance-runner.js'
import { ObjectRouter } from '../lib/rule-router.js'
import { preflight } from '../lib/rule-preflight.js'
import { processOutput } from '../lib/rule-worker.js'
import { KERNEL_HASH } from '../lib/rule-contract.js'
assert(process.argv[2] && process.argv[3], 'Supply a private auth file and a NEW output directory; this makes paid model calls')
const authFile=await realpath(resolve(process.argv[2])), authStat=await lstat(authFile)
assert(authStat.isFile() && !authStat.isSymbolicLink() && !(authStat.mode&0o077),'Private auth file required')
const auth=JSON.parse(await readFile(authFile,'utf8')), output=resolve(process.argv[3])
await mkdir(output,{recursive:false,mode:0o700})
const root=join(output,'task-workspace'),scratch=join(output,'.sandbox')
await mkdir(root);await mkdir(scratch)
const store=new RuleStore(await realpath(root))
await store.configure({enabled:true,image:'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'',snapshotDirectory:scratch,triggerTimeoutMs:5000})
const check=await preflight((await store.read()).config)
await writeFile(join(output,'preflight.json'),JSON.stringify(check,null,2));assert(check.ready,'Preflight failed; no model request made')
await writeFile(join(store.dir,'admission.json'),await readFile(new URL('../examples/rule-admission.json',import.meta.url)))
// Synthetic tasks, but outcomes are actually measured by a trusted host evaluator.
for(let i=0;i<3;i++){
 const name=`history-${i}.txt`;await writeFile(join(root,name),'example')
 const text=(await readdir(root)).filter(n=>!n.startsWith('.')).sort().map(n=>n+'\n').join('')
 await observeVerified(store,{id:`observed-${i}`,family:'list-files',request:'list visible files',output:text,oracle_id:`host-directory-listing-${i}`,verified:true})
 await writeFile(join(output,`history-${i}.json`),JSON.stringify({files:[name],request:'list visible files',expected:text}))
 await unlink(join(root,name))
}
await configureMaintenance(store,{enabled:true,maxCalls:20,maxAttempts:3,timeoutMs:600000,maxOutputTokens:6000})
const journal=join(output,'http.jsonl'),loader=join(output,'.network-loader.mjs')
await writeFile(journal,'',{mode:0o600})
await writeFile(loader,`process.env.ROUTER_ACCEPTANCE_AUTH=${JSON.stringify(authFile)};process.env.ROUTER_ACCEPTANCE_JOURNAL=${JSON.stringify(journal)};process.env.ROUTER_ACCEPTANCE_MAX_CALLS='20';await import(${JSON.stringify(new URL('./acceptance-network.js',import.meta.url).href)});`,{mode:0o600})
const controller=new MaintenanceController(store,dshMaintenanceRunner(store,{authFile,loader})),chain=await controller.next()
const manifest={startedAt:new Date().toISOString(),model:auth.model??'deepseek-v4-flash',endpoint:auth.baseURL,kernelHash:KERNEL_HASH,maxCalls:20,chainId:chain.id,root,data:'synthetic tasks with measured host oracles; engineering acceptance, not a benchmark'}
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2))
let result
for(let attempt=0;attempt<3;attempt++){
 result=await controller.run(chain.id)
 await writeFile(join(output,`attempt-${attempt+1}.json`),JSON.stringify(result,null,2))
 if(result.status!=='retry')break
}
let route, boundary, dsh, networkAttempts
if(result.status==='complete'){
 await writeFile(join(root,'new-after-learning.txt'),'new file')
 route=await new ObjectRouter(root).route('list visible files')
 boundary=await new ObjectRouter(root).route('list hidden files')
 const attempts=join(root,'.network-attempts'),deny=join(root,'.deny-network.mjs')
 await writeFile(attempts,'');await writeFile(deny,`import{appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(attempts)},'attempt\\n');throw Error('NETWORK_FORBIDDEN')}`)
 dsh=await processOutput(process.execPath,['--import',deny,fileURLToPath(new URL('../run.js',import.meta.url)),'list visible files'],{cwd:root,timeoutMs:45000})
 networkAttempts=await readFile(attempts,'utf8')
}
const state=await store.read(),calls=Object.values(state.maintenance.calls),http=(await readFile(journal,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x))
const usage=Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'].map(k=>[k,calls.reduce((n,c)=>n+(c.usage?.[k]??0),0)]))
usage.totalInputTokens=usage.inputTokens+usage.cacheReadTokens+usage.cacheWriteTokens
const summary={...manifest,finishedAt:new Date().toISOString(),status:result.status,calls:calls.length,httpRequests:http.filter(x=>x.type==='request').length,unknownUsageCalls:calls.filter(c=>!c.usage).length,usage,active:state.active,route,boundary,dsh,networkAttempts,passed:result.status==='complete'&&route?.text==='new-after-learning.txt\n'&&boundary?.kind==='fallback'&&dsh?.exitCode===0&&dsh?.stdout.trim()==='new-after-learning.txt'&&networkAttempts===''}
await writeFile(join(output,'state.json'),JSON.stringify(state,null,2))
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({output,passed:summary.passed,status:summary.status,calls:summary.calls,httpRequests:summary.httpRequests,usage:summary.usage},null,2))
if(!summary.passed)process.exitCode=2
