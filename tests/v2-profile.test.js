import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CapabilityStore,checkFrozen} from '../lib/v2/core.js'
import {installSeed,develop} from '../lib/v2/runner.js'
import {processOutput} from '../lib/rule-worker.js'
test('full DSH autonomously executes test failure, edits, reruns and publishes; frozen route uses no model',{skip:process.env.ROUTER_V2_PROFILE_TEST!=='1'},async t=>{
 const shared=process.env.ROUTER_V2_SHARED;await mkdir(shared,{recursive:true});const base=await mkdtemp(join(shared,'profile-')),root=join(base,'task'),scratch=join(base,'snap');await mkdir(root);await mkdir(scratch);t.after(()=>rm(base,{recursive:true,force:true}));await writeFile(join(root,'a.php'),'a\n');const store=new CapabilityStore(root);await installSeed(store,{enabled:true,image:'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch,pids:64,triggerTimeoutMs:5000});const prior=(await store.read()).active.files
 const auth=join(base,'auth.json'),loader=join(base,'loader.mjs'),journal=join(base,'mock.jsonl');await writeFile(auth,JSON.stringify({apiKey:'offline-only',baseURL:'https://starter-test.invalid/v1'}),{mode:0o600});await writeFile(loader,`process.env.V2_MOCK_JOURNAL=${JSON.stringify(journal)};await import(${JSON.stringify(new URL('./mock-v2-provider.js',import.meta.url).href)})`)
 const result=await develop(store,{authFile:auth,loader,maxCalls:6});assert.equal(result.status,'complete',JSON.stringify(result));const s=await store.read();assert.notEqual(s.active.files,prior);assert.equal(s.sessions[result.sid].calls.length,5);assert(s.sessions[result.sid].commands.some(x=>x.result.exitCode!==0));assert(s.sessions[result.sid].commands.some(x=>x.result.exitCode===0));const frozen=await store.freeze();const deny=join(base,'deny.mjs');await writeFile(deny,"globalThis.fetch=async()=>{throw Error('NO_NETWORK')}");const run=await processOutput(process.execPath,['--import',deny,fileURLToPath(new URL('../run.js',import.meta.url)),'Count total lines in PHP files in /testbed'],{cwd:root,timeoutMs:180000});assert.equal(run.exitCode,0,JSON.stringify(run));assert.equal(run.stdout.trim(),'1');await checkFrozen(store,frozen)
})
