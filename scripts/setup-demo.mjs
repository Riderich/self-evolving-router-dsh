import { mkdir, realpath, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { RuleStore } from '../lib/rule-store.js'
import { configureMaintenance, observeVerified } from '../lib/maintenance-state.js'
const root=resolve(process.argv[2]??'demo-workspace')
await mkdir(root,{recursive:true})
const store=new RuleStore(await realpath(root)),snap=resolve(process.env.ROUTER_SNAPSHOT_DIR??'.sandbox')
await mkdir(snap,{recursive:true})
await store.configure({enabled:true,image:process.env.ROUTER_TEST_IMAGE??'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',pythonVersion:process.env.ROUTER_TEST_PYTHON??'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'',snapshotDirectory:snap,triggerTimeoutMs:5000})
// These are deliberately synthetic evaluator fixtures, never research evidence.
await writeFile(join(store.dir,'admission.json'),await readFile(new URL('../examples/rule-admission.json',import.meta.url)),{flag:'wx'})
for(let i=0;i<3;i++)await observeVerified(store,{id:`demo-${i}`,family:'list-files',request:'list visible files',output:`file-${i}.txt\n`,verified:true,oracle_id:`synthetic-listing-oracle-${i}`})
await configureMaintenance(store,{enabled:true,maxCalls:20})
console.log(JSON.stringify({root:store.root,ready:true,modelCalls:0,note:'Synthetic demo ready; evolve will call your configured model, at most 20 times total.'},null,2))
