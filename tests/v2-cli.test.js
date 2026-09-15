import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readdir,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {processOutput} from '../lib/rule-worker.js'
import {CapabilityStore} from '../lib/v2/core.js'
const cli=fileURLToPath(new URL('../v2.js',import.meta.url))
async function workspace(t){const p=await realpath(await mkdtemp(join(tmpdir(),'router-cli-')));t.after(()=>rm(p,{recursive:true,force:true}));return p}
test('status is read-only on an uninitialized workspace; invalid commands do not initialize it',async t=>{
 const root=await workspace(t)
 let r=await processOutput(process.execPath,[cli,'status',root]);assert.equal(r.exitCode,0);assert.equal(JSON.parse(r.stdout).initialized,false);assert.deepEqual(await readdir(root),[])
 for(const command of ['route','unknown']){r=await processOutput(process.execPath,[cli,command,root]);assert.equal(r.exitCode,1);assert.deepEqual(await readdir(root),[])}
 r=await processOutput(process.execPath,[cli,'init',root,root]);assert.equal(r.exitCode,1);assert.match(r.stderr,/outside/);assert.deepEqual(await readdir(root),[])
})
test('failed development returns nonzero status rather than shell success without calling a model',async t=>{
 const base=await workspace(t),root=join(base,'task'),snap=join(base,'snap'),auth=join(base,'auth.json');await mkdir(root);await mkdir(snap);await writeFile(auth,'{}',{mode:0o600});const store=new CapabilityStore(root);await store.configure({snapshotDirectory:snap})
 const r=await processOutput(process.execPath,[cli,'develop',root,auth,'1'],{timeoutMs:30000});assert.equal(r.exitCode,1);assert.equal(JSON.parse(r.stdout).status,'failed');assert.equal(Object.values((await store.read()).sessions).at(-1).calls.length,0)
})
