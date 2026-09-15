#!/usr/bin/env node
// Read-only diagnostics: no model calls, downloads, container starts or state writes.
import {readFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {processOutput} from '../lib/rule-worker.js'
import {dshRuntime} from '../lib/dsh-runtime.js'
const args=process.argv.slice(2)
if(args.includes('--help')){console.log('node scripts/doctor.mjs [--json]\nChecks Node, pinned DSH, installed router profile, Docker daemon and pinned image. No API calls or changes.');process.exit(0)}
if(args.some(a=>a!=='--json')){console.error('Unknown option; use --help');process.exit(1)}
const checks=[]
async function check(name,fn,remedy){try{const detail=await fn();checks.push({name,ok:true,detail})}catch(e){checks.push({name,ok:false,detail:e.message,remedy})}}
await check('Node.js',()=>{if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22+ required');return process.versions.node},'Install Node.js 22 or newer.')
let runtime
await check('Pinned DSH',async()=>{runtime=await dshRuntime();return runtime.version},'Run npm ci, or point DSH_ROUTER_RUNTIME to a pinned runtime.')
await check('Router profile',async()=>{if(!runtime)throw Error('DSH runtime unavailable');const root=join(runtime.home,'profiles/router'),p=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(!p.dsh?.profile?.bundles?.includes('dsh-prellm-router'))throw Error('Router bundle not registered');if(await realpath(join(root,'node_modules/dsh-prellm-router'))!==await realpath(fileURLToPath(new URL('../',import.meta.url))))throw Error('Profile points to another checkout');return root},'Run node install.js with the same DSH_HOME used to run the plugin.')
const context=process.env.ROUTER_DOCKER_CONTEXT??process.env.DOCKER_CONTEXT??'',prefix=context?['--context',context]:[]
async function docker(args){const r=await processOutput('docker',[...prefix,...args],{timeoutMs:15000,maxOutputBytes:16000});if(r.exitCode!==0)throw Error(r.stderr.trim()||'Docker command failed');return r.stdout.trim()}
await check('Docker daemon',()=>docker(['info','--format','{{.ServerVersion}}']),`Start Docker and check its context${context?' ('+context+')':''}. Colima: export ROUTER_DOCKER_CONTEXT=colima.`)
const image='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285'
await check('Pinned image',()=>docker(['image','inspect',image,'--format','{{.Id}}']),`Run docker${context?' --context '+context:''} pull ${image}`)
const result={ok:checks.every(c=>c.ok),modelCalls:0,context:context||'Docker configured default',checks}
if(args.includes('--json'))console.log(JSON.stringify(result,null,2));else for(const c of checks){console.log(`${c.ok?'PASS':'FAIL'} ${c.name}: ${c.detail}`);if(!c.ok)console.log(`  ${c.remedy}`)}
if(!result.ok)process.exitCode=1
